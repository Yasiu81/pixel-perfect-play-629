import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Settings, User, KeyRound, Bell, Loader2, CheckCircle2, BellOff } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";

export const Route = createFileRoute("/_authenticated/_coordinator/ustawienia")({
  component: UstawieniaPage,
});

const profileSchema = z.object({
  imie: z.string().trim().min(1, "Wymagane").max(80),
  nazwisko: z.string().trim().min(1, "Wymagane").max(80),
  telefon: z.string().trim().max(20).optional().or(z.literal("")),
});
type ProfileForm = z.infer<typeof profileSchema>;

const passwordSchema = z
  .object({
    password: z.string().min(8, "Minimum 8 znaków"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: "Hasła nie są takie same",
    path: ["confirm"],
  });
type PasswordForm = z.infer<typeof passwordSchema>;

function UstawieniaPage() {
  const qc = useQueryClient();

  const { data: me, isLoading } = useQuery({
    queryKey: ["me-settings"],
    queryFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return null;
      const { data: profile } = await supabase
        .from("profiles")
        .select("id, imie, nazwisko, telefon, email")
        .eq("id", userData.user.id)
        .single();
      return profile ?? null;
    },
  });

  const profileForm = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    values: me ? { imie: me.imie, nazwisko: me.nazwisko, telefon: me.telefon ?? "" } : undefined,
  });

  const saveProfileMut = useMutation({
    mutationFn: async (v: ProfileForm) => {
      if (!me) throw new Error("Brak danych użytkownika");
      const { error } = await supabase
        .from("profiles")
        .update({ imie: v.imie.trim(), nazwisko: v.nazwisko.trim(), telefon: v.telefon?.trim() || null })
        .eq("id", me.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Dane konta zaktualizowane");
      qc.invalidateQueries({ queryKey: ["me-settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const passwordForm = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { password: "", confirm: "" },
  });

  const changePasswordMut = useMutation({
    mutationFn: async (v: PasswordForm) => {
      const { error } = await supabase.auth.updateUser({ password: v.password });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Hasło zostało zmienione");
      passwordForm.reset();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [notifPermission, setNotifPermission] = useState<NotificationPermission | "unsupported">(
    typeof Notification !== "undefined" ? Notification.permission : "unsupported",
  );

  const requestNotifPermission = async () => {
    if (typeof Notification === "undefined") return;
    const perm = await Notification.requestPermission();
    setNotifPermission(perm);
    if (perm === "granted") toast.success("Powiadomienia przeglądarki włączone");
    else if (perm === "denied") toast.error("Powiadomienia zablokowane — włącz je ręcznie w ustawieniach przeglądarki");
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Settings className="h-6 w-6" /> Ustawienia konta
        </h1>
        <p className="text-sm text-muted-foreground">Twoje dane, hasło i preferencje powiadomień.</p>
      </div>

      {/* Dane konta */}
      <div className="rounded-xl border bg-card p-5">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
          <User className="h-4 w-4" /> Dane konta
        </h2>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Wczytywanie...</p>
        ) : (
          <Form {...profileForm}>
            <form onSubmit={profileForm.handleSubmit((v) => saveProfileMut.mutate(v))} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-muted-foreground">E-mail</label>
                <Input value={me?.email ?? ""} disabled className="bg-muted/40" />
                <p className="text-xs text-muted-foreground">
                  Zmiana adresu e-mail nie jest jeszcze obsługiwana w tym panelu.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormField control={profileForm.control} name="imie" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Imię</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={profileForm.control} name="nazwisko" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nazwisko</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <FormField control={profileForm.control} name="telefon" render={({ field }) => (
                <FormItem>
                  <FormLabel>Telefon</FormLabel>
                  <FormControl><Input placeholder="np. 504 999 571" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <Button type="submit" disabled={saveProfileMut.isPending}>
                {saveProfileMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Zapisz dane
              </Button>
            </form>
          </Form>
        )}
      </div>

      {/* Zmiana hasła */}
      <div className="rounded-xl border bg-card p-5">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
          <KeyRound className="h-4 w-4" /> Zmiana hasła
        </h2>
        <Form {...passwordForm}>
          <form onSubmit={passwordForm.handleSubmit((v) => changePasswordMut.mutate(v))} className="space-y-4">
            <FormField control={passwordForm.control} name="password" render={({ field }) => (
              <FormItem>
                <FormLabel>Nowe hasło</FormLabel>
                <FormControl><Input type="password" placeholder="Minimum 8 znaków" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={passwordForm.control} name="confirm" render={({ field }) => (
              <FormItem>
                <FormLabel>Powtórz nowe hasło</FormLabel>
                <FormControl><Input type="password" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <Button type="submit" disabled={changePasswordMut.isPending}>
              {changePasswordMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Zmień hasło
            </Button>
          </form>
        </Form>
      </div>

      {/* Powiadomienia przeglądarki */}
      <div className="rounded-xl border bg-card p-5">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
          <Bell className="h-4 w-4" /> Powiadomienia przeglądarki
        </h2>
        {notifPermission === "unsupported" ? (
          <p className="text-sm text-muted-foreground">Ta przeglądarka nie obsługuje powiadomień.</p>
        ) : notifPermission === "granted" ? (
          <div className="flex items-center gap-2 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4" /> Powiadomienia są włączone w tej przeglądarce.
          </div>
        ) : notifPermission === "denied" ? (
          <div className="flex items-center gap-2 text-sm text-red-700">
            <BellOff className="h-4 w-4" />
            Powiadomienia zablokowane. Włącz je ręcznie w ustawieniach przeglądarki (ikona kłódki przy adresie strony).
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Zezwól na powiadomienia, aby dostawać alerty również gdy karta jest w tle.
            </p>
            <Button variant="outline" onClick={requestNotifPermission}>Włącz powiadomienia</Button>
          </div>
        )}
      </div>
    </div>
  );
}
