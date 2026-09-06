import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg active:brightness-90',
  secondary: 'bg-surface text-text border border-border active:bg-surface-muted',
  ghost: 'text-text-muted active:bg-surface-muted',
  danger: 'bg-negative text-white active:brightness-90',
};

/**
 * Mindesthoehe 44 Pixel in allen Groessen - das ist die von Apple empfohlene
 * kleinste Trefferflaeche fuer eine Fingerspitze. Kleinere Schaltflaechen
 * sind auf dem iPhone spuerbar schwerer zu treffen.
 */
const SIZES: Record<Size, string> = {
  md: 'min-h-11 px-4 text-[15px]',
  lg: 'min-h-13 px-5 text-base',
};

export function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-medium',
        'transition-[filter,background-color] duration-100',
        'focus-visible:outline-accent focus-visible:outline-2 focus-visible:outline-offset-2',
        'disabled:pointer-events-none disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...props}
    />
  );
}
