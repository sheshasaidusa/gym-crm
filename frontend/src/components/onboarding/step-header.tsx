export function StepHeader({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <header className="flex flex-col gap-2">
      <h1 className="text-3xl font-semibold tracking-tight text-balance" tabIndex={-1} data-step-title>
        {title}
      </h1>
      <p className="text-muted-foreground">{children}</p>
    </header>
  );
}
