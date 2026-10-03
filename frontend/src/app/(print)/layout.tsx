import { SessionGate } from "@/components/session-gate";

/** Logged-in pages without the app chrome, laid out for printing (receipts). */
export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return <SessionGate>{children}</SessionGate>;
}
