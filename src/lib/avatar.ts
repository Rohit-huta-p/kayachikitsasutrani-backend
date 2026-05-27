export function deriveAvatar(name: string, email: string): { initials: string; color: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials = (parts.length === 0
    ? "?"
    : parts.length === 1
      ? parts[0].slice(0, 2)
      : parts[0][0] + parts[parts.length - 1][0]
  ).toUpperCase();
  let h = 0;
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) % 360;
  return { initials, color: `hsl(${h}, 55%, 65%)` };
}
