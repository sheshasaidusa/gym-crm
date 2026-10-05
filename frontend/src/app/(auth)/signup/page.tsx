import { redirect } from "next/navigation";

/** Signup now happens in the onboarding wizard. Old links keep working. */
export default function SignupPage() {
  redirect("/onboarding");
}
