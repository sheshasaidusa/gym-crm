export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-4 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="self-center font-semibold">dunamis</div>
        {children}
      </div>
    </div>
  );
}
