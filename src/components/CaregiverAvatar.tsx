import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

const FALLBACK_COLORS = [
  "bg-rose-500", "bg-orange-500", "bg-amber-500", "bg-emerald-500",
  "bg-teal-500", "bg-sky-500", "bg-indigo-500", "bg-violet-500", "bg-pink-500",
];

function colorForName(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return FALLBACK_COLORS[Math.abs(hash) % FALLBACK_COLORS.length];
}

function initials(imie: string, nazwisko: string) {
  return `${imie?.[0] ?? ""}${nazwisko?.[0] ?? ""}`.toUpperCase() || "?";
}

export function avatarPublicUrl(avatarPath: string | null | undefined): string | null {
  if (!avatarPath) return null;
  return supabase.storage.from("avatars").getPublicUrl(avatarPath).data.publicUrl;
}

export function CaregiverAvatar({
  avatarPath,
  imie,
  nazwisko,
  className,
}: {
  avatarPath: string | null | undefined;
  imie: string;
  nazwisko: string;
  className?: string;
}) {
  const url = avatarPublicUrl(avatarPath);
  const name = `${imie} ${nazwisko}`;
  return (
    <Avatar className={cn("h-10 w-10", className)}>
      {url && <AvatarImage src={url} alt={name} />}
      <AvatarFallback className={cn("text-white font-medium", colorForName(name))}>
        {initials(imie, nazwisko)}
      </AvatarFallback>
    </Avatar>
  );
}
