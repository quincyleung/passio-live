"use client";

// Signed in: the live tracker. Signed out: a short intro with one button. It goes
// to /sign-in, which links to the separate /sign-up page for new users.
// This check runs in the browser. The data itself is protected by row-level
// security, which checks the Clerk token on every request.

import { useAuth, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import LiveTracker from "./live-tracker";

export default function Home() {
  const { isLoaded, isSignedIn } = useAuth();

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h1 className="text-base font-semibold">
          UChicago Shuttles <span className="text-[#800000] dark:text-[#e8a0a0]">Live</span>
        </h1>
        {isSignedIn && <UserButton />}
      </header>

      {!isLoaded ? (
        <p className="p-4 text-sm text-zinc-500">Loading…</p>
      ) : isSignedIn ? (
        <LiveTracker />
      ) : (
        <main className="mx-auto flex max-w-md flex-1 flex-col justify-center gap-4 px-4 py-16">
          <h2 className="text-2xl font-semibold">Watch UChicago shuttles move, live.</h2>
          <p className="text-zinc-600 dark:text-zinc-400">
            Pick the routes you ride and track the buses on a map.
          </p>
          <Link
            href="/sign-in"
            className="self-start rounded-md bg-[#800000] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#6a0000]"
          >
            Start tracking
          </Link>
        </main>
      )}
    </div>
  );
}
