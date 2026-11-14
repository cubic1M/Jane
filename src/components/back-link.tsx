import Link from "next/link";

// The link back to the page a sub-page belongs to ("← Taxes"), above its heading. Each page
// passes its own link style.
export function BackLink({
  href,
  label,
  className,
}: {
  href: string;
  label: string;
  className: string;
}) {
  return (
    <Link href={href} className={`text-sm ${className}`}>
      {`← ${label}`}
    </Link>
  );
}
