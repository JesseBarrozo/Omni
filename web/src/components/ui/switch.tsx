import { Switch as SwitchPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

const trackClassName =
  "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent p-0.5 transition-colors data-[state=checked]:bg-foreground data-[state=unchecked]:bg-muted-foreground/30";
const thumbClassName =
  "pointer-events-none block size-3.5 translate-x-0 rounded-full bg-background shadow-sm transition-transform data-[state=checked]:translate-x-4";

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        trackClassName,
        "cursor-pointer outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb data-slot="switch-thumb" className={thumbClassName} />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
