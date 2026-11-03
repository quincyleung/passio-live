"use client";

// The map. Leaflet needs the browser, so live-tracker.tsx loads this file with
// ssr: false. Bus names and colors come from Passio, so they're escaped or
// checked before they go into the marker's HTML.

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";

export type MapBus = {
  id: string;
  name: string;
  routeName: string;
  lat: number;
  lng: number;
  heading: number | null;
  color: string | null;
  gpsStale: boolean;
  outOfService: boolean;
};

export type MapMode = "normal" | "stale" | "down";

const CAMPUS: L.LatLngTuple = [41.7886, -87.5987];
const SAFE_COLOR = /^#[0-9a-f]{3,8}$/i;
const FALLBACK_COLOR = "#52525b";

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function iconHtml(bus: MapBus, mode: MapMode): string {
  const color = bus.color && SAFE_COLOR.test(bus.color) ? bus.color : FALLBACK_COLOR;
  const classes = ["bus-dot"];
  if (mode !== "normal" || bus.gpsStale || bus.outOfService) classes.push("bus-faded");
  if (bus.gpsStale) classes.push("bus-gps-stale");
  if (mode === "down") classes.push("bus-down");
  const arrow =
    bus.heading !== null && Number.isFinite(bus.heading)
      ? `<span class="bus-arrow" style="transform: rotate(${Math.round(bus.heading)}deg)"></span>`
      : "";
  return `<span class="${classes.join(" ")}" style="--bus: ${color}">${arrow}<span class="bus-label">${escapeHtml(bus.name)}</span></span>`;
}

function tooltipHtml(bus: MapBus): string {
  const notes = [bus.outOfService ? "out of service" : "", bus.gpsStale ? "GPS not updating" : ""].filter(Boolean);
  return escapeHtml(`${bus.name} · ${bus.routeName}${notes.length ? ` (${notes.join(", ")})` : ""}`);
}

function makeIcon(html: string): L.DivIcon {
  return L.divIcon({ className: "bus-icon", html, iconSize: [18, 18], iconAnchor: [9, 9], tooltipAnchor: [12, 0] });
}

export default function BusMap({ buses, mode }: { buses: MapBus[]; mode: MapMode }) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markers = useRef(new Map<string, { marker: L.Marker; html: string; tip: string }>());
  const fitted = useRef(false);

  // Create the map once.
  useEffect(() => {
    if (!box.current) return;
    const map = L.map(box.current, { center: CAMPUS, zoom: 14 });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    mapRef.current = map;
    // Leaflet only notices window resizes. Tell it when its own box changes size,
    // for example when the route buttons wrap onto another line.
    const resize = new ResizeObserver(() => map.invalidateSize());
    resize.observe(box.current);
    const current = markers.current;
    return () => {
      resize.disconnect();
      map.remove();
      mapRef.current = null;
      current.clear();
      fitted.current = false;
    };
  }, []);

  // Move, add and remove markers. Only rebuild a marker's icon when it changed.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const seen = new Set<string>();
    for (const bus of buses) {
      seen.add(bus.id);
      const html = iconHtml(bus, mode);
      const tip = tooltipHtml(bus);
      const found = markers.current.get(bus.id);
      if (!found) {
        const marker = L.marker([bus.lat, bus.lng], { icon: makeIcon(html), keyboard: false }).bindTooltip(tip).addTo(map);
        markers.current.set(bus.id, { marker, html, tip });
        continue;
      }
      found.marker.setLatLng([bus.lat, bus.lng]);
      if (found.html !== html) {
        found.marker.setIcon(makeIcon(html));
        found.html = html;
      }
      if (found.tip !== tip) {
        found.marker.setTooltipContent(tip);
        found.tip = tip;
      }
    }
    for (const [id, { marker }] of markers.current) {
      if (!seen.has(id)) {
        marker.remove();
        markers.current.delete(id);
      }
    }
    // Zoom to the buses the first time there are any.
    if (!fitted.current && buses.length > 0) {
      map.fitBounds(L.latLngBounds(buses.map((b) => [b.lat, b.lng] as L.LatLngTuple)), { padding: [40, 40], maxZoom: 15 });
      fitted.current = true;
    }
  }, [buses, mode]);

  // Pinned to the edges of its parent (which is `relative` with a minimum height).
  // A 100% height wouldn't work there: the parent has no fixed height to take 100% of.
  return <div ref={box} className="absolute inset-0" aria-label="Map of buses on your routes" role="region" />;
}
