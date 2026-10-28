import { cn } from '@restroos/ui';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

/**
 * Renders `value` as a QR code. SVG (not canvas), so it is sharp when printed
 * and works without a canvas (tests, older WebViews). Error correction M
 * survives a little grease on a laminated table card.
 */
export function QrImage({
  value,
  label,
  className,
}: {
  value: string;
  /** Accessible description, e.g. "QR code for table T4". */
  label: string;
  className?: string;
}) {
  const [svg, setSvg] = useState<{ value: string; src: string } | null>(null);

  useEffect(() => {
    let alive = true;
    void QRCode.toString(value, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }).then(
      (markup) => {
        if (alive) {
          setSvg({ value, src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}` });
        }
      },
    );
    return () => {
      alive = false;
    };
  }, [value]);

  return svg === null || svg.value !== value ? (
    <div
      role="img"
      aria-label={label}
      aria-busy="true"
      className={cn('aspect-square animate-pulse rounded-lg bg-muted', className)}
    />
  ) : (
    <img
      src={svg.src}
      alt={label}
      data-qr-value={value}
      className={cn('aspect-square bg-white [image-rendering:pixelated]', className)}
    />
  );
}
