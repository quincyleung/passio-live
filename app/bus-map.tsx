"use client";

// The map. Leaflet needs the browser, so live-tracker.tsx loads this file with
// ssr: false. Bus and stop names and colors come from Passio, so they're
// escaped or checked before they go into the map's HTML.

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import type { MapStop } from "./lib/live";

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
// Stops are small white circles. Leaflet draws them in a layer below the bus
// markers, so a bus at a stop is always on top.
const STOP_STYLE: L.CircleMarkerOptions = { radius: 4, color: "#3f3f46", weight: 2, fillColor: "#ffffff", fillOpacity: 1 };

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

export default function BusMap({ buses, stops, mode }: { buses: MapBus[]; stops: MapStop[]; mode: MapMode }) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const stopLayer = useRef<L.LayerGroup | null>(null);
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
    stopLayer.current = L.layerGroup().addTo(map);
    // Leaflet only notices window resizes. Tell it when its own box changes size,
    // for example when the route buttons wrap onto another line.
    const resize = new ResizeObserver(() => map.invalidateSize());
    resize.observe(box.current);
    const current = markers.current;
    return () => {
      resize.disconnect();
      map.remove();
      mapRef.current = null;
      stopLayer.current = null;
      current.clear();
      fitted.current = false;
    };
  }, []);

  // Stops on the user's routes. The list only changes when they follow or
  // unfollow a route (or the page loads again), so it's simply redrawn.
  useEffect(() => {
    const layer = stopLayer.current;
    if (!layer) return;
    layer.clearLayers();
    for (const stop of stops) {
      L.circleMarker([stop.lat, stop.lng], STOP_STYLE)
        .bindTooltip(escapeHtml(`${stop.name} · ${stop.routes.join(", ")}`))
        .addTo(layer);
    }
  }, [stops]);

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
  }, [buses, mode]);

  // Zoom to the buses and stops the first time there are any.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || fitted.current) return;
    const points = [...buses, ...stops].map((p) => [p.lat, p.lng] as L.LatLngTuple);
    if (points.length === 0) return;
    map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 15 });
    fitted.current = true;
  }, [buses, stops]);

  // Pinned to the edges of its parent (which is `relative` with a minimum height).
  // A 100% height wouldn't work there: the parent has no fixed height to take 100% of.
  return <div ref={box} className="absolute inset-0" aria-label="Map of buses and stops on your routes" role="region" />;
}
