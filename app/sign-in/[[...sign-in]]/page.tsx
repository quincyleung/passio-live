import { SignIn } from "@clerk/nextjs";
import { Suspense } from "react";

export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Suspense>
        {/* Sign in or sign up in one form: a new email goes on to make an account. */}
        <SignIn withSignUp />
      </Suspense>
    </div>
  );
}
