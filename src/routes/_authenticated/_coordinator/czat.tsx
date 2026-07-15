import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MessageCircle, Send, Loader2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { CaregiverAvatar } from "@/components/CaregiverAvatar";

type CzatSearch = { opiekun?: string };

export const Route = createFileRoute("/_authenticated/_coordinator/czat")({
  validateSearch: (search: Record<string, unknown>): CzatSearch => ({
    opiekun: typeof search.opiekun === "string" ? search.opiekun : undefined,
  }),
  component: CzatPage,
});

type Message = {
  id: string;
  caregiver_id: string;
  sender_id: string;
  body: string;
  read_at: string | null;
  created_at: string;
};

type Caregiver = { id: string; imie: string; nazwisko: string; avatar_path: string | null };

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
}
function fmtDay(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  if (isToday) return "Dziś";
  return d.toLocaleDateString("pl-PL", { day: "numeric", month: "long" });
}

function CzatPage() {
  const { opiekun } = Route.useSearch();
  const [meId, setMeId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(opiekun ?? null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMeId(data.user?.id ?? null));
  }, []);

  const { data: caregivers, isLoading: loadingCaregivers } = useQuery({
    queryKey: ["chat-caregivers"],
    queryFn: async () => {
      const { data: roles } = await supabase.from("user_roles").select("user_id").eq("role", "caregiver");
      const ids = (roles ?? []).map((r) => r.user_id);
      if (ids.length === 0) return [] as Caregiver[];
      const { data, error } = await supabase.from("profiles").select("id, imie, nazwisko, avatar_path").in("id", ids).order("nazwisko");
      if (error) throw error;
      return (data ?? []) as unknown as Caregiver[];
    },
  });

  // Podgląd ostatniej wiadomości + liczba nieprzeczytanych per opiekun (do listy wątków)
  const { data: allMessages } = useQuery({
    queryKey: ["chat-all-messages-preview"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("id, caregiver_id, sender_id, body, read_at, created_at")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as Message[];
    },
    refetchInterval: 15_000,
  });

  const previewByCaregiver = useMemo(() => {
    const m: Record<string, { last: Message; unread: number }> = {};
    for (const msg of allMessages ?? []) {
      if (!m[msg.caregiver_id]) m[msg.caregiver_id] = { last: msg, unread: 0 };
      if (msg.sender_id === msg.caregiver_id && !msg.read_at) m[msg.caregiver_id].unread++;
    }
    return m;
  }, [allMessages]);

  useEffect(() => {
    if (!selectedId && caregivers && caregivers.length > 0) {
      setSelectedId(caregivers[0].id);
    }
  }, [caregivers, selectedId]);

  const sortedCaregivers = useMemo(() => {
    return [...(caregivers ?? [])].sort((a, b) => {
      const ta = previewByCaregiver[a.id]?.last.created_at ?? "";
      const tb = previewByCaregiver[b.id]?.last.created_at ?? "";
      return tb.localeCompare(ta);
    });
  }, [caregivers, previewByCaregiver]);

  return (
    <div className="flex h-[calc(100vh-3rem)] gap-4">
      <div>
        <h1 className="mb-3 flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <MessageCircle className="h-6 w-6" /> Czat
        </h1>
      </div>

      <div className="flex h-full w-full gap-4 overflow-hidden">
        {/* Lista wątków */}
        <div className="w-72 flex-shrink-0 space-y-1.5 overflow-y-auto pb-4">
          {loadingCaregivers ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)
          ) : sortedCaregivers.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
              Brak opiekunów.
            </div>
          ) : (
            sortedCaregivers.map((c) => {
              const preview = previewByCaregiver[c.id];
              const isSelected = selectedId === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={`w-full rounded-xl border p-3 text-left transition-all ${
                    isSelected ? "border-primary bg-primary/5 shadow-sm" : "bg-card hover:bg-muted/50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <CaregiverAvatar avatarPath={c.avatar_path} imie={c.imie} nazwisko={c.nazwisko} className="h-9 w-9 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{c.nazwisko} {c.imie}</div>
                      {preview?.last && (
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">
                          {preview.last.body}
                        </div>
                      )}
                    </div>
                    {!!preview?.unread && (
                      <span className="flex h-5 min-w-5 flex-shrink-0 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                        {preview.unread > 9 ? "9+" : preview.unread}
                      </span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Wątek */}
        <div className="flex-1 overflow-hidden rounded-xl border bg-card">
          {selectedId && meId ? (
            <ThreadPanel
              key={selectedId}
              caregiverId={selectedId}
              meId={meId}
              caregiverLabel={
                sortedCaregivers.find((c) => c.id === selectedId)
                  ? `${sortedCaregivers.find((c) => c.id === selectedId)!.nazwisko} ${sortedCaregivers.find((c) => c.id === selectedId)!.imie}`
                  : ""
              }
              caregiverAvatarPath={sortedCaregivers.find((c) => c.id === selectedId)?.avatar_path ?? null}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Wybierz opiekuna z listy, aby zobaczyć rozmowę.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ThreadPanel({
  caregiverId,
  meId,
  caregiverLabel,
  caregiverAvatarPath,
}: {
  caregiverId: string;
  meId: string;
  caregiverLabel: string;
  caregiverAvatarPath: string | null;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: messages, isLoading } = useQuery({
    queryKey: ["chat-thread", caregiverId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("id, caregiver_id, sender_id, body, read_at, created_at")
        .eq("caregiver_id", caregiverId)
        .order("created_at", { ascending: true })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as Message[];
    },
  });

  // Realtime — nowe wiadomości w tym wątku
  useEffect(() => {
    const channel = supabase
      .channel(`messages-${caregiverId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `caregiver_id=eq.${caregiverId}` },
        () => qc.invalidateQueries({ queryKey: ["chat-thread", caregiverId] }),
      )
      .subscribe();
    return () => { channel.unsubscribe(); };
  }, [caregiverId, qc]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Oznacz jako przeczytane wiadomości od opiekuna po otwarciu wątku
  useEffect(() => {
    const unreadIds = (messages ?? [])
      .filter((m) => m.sender_id === caregiverId && !m.read_at)
      .map((m) => m.id);
    if (unreadIds.length === 0) return;
    supabase.from("messages").update({ read_at: new Date().toISOString() } as never)
      .in("id", unreadIds)
      .then(({ error }) => {
        if (!error) qc.invalidateQueries({ queryKey: ["chat-all-messages-preview"] });
      });
  }, [messages, caregiverId, qc]);

  const sendMut = useMutation({
    mutationFn: async (body: string) => {
      const { error } = await supabase.from("messages").insert({
        caregiver_id: caregiverId,
        sender_id: meId,
        body,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      setDraft("");
      qc.invalidateQueries({ queryKey: ["chat-thread", caregiverId] });
      qc.invalidateQueries({ queryKey: ["chat-all-messages-preview"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleSend = () => {
    const body = draft.trim();
    if (!body) return;
    sendMut.mutate(body);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <CaregiverAvatar
          avatarPath={caregiverAvatarPath}
          imie={caregiverLabel.split(" ")[1] ?? ""}
          nazwisko={caregiverLabel.split(" ")[0] ?? ""}
          className="h-9 w-9"
        />
        <h2 className="font-semibold">{caregiverLabel}</h2>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (messages ?? []).length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Brak wiadomości. Napisz pierwszą wiadomość do tego opiekuna.
          </p>
        ) : (
          (messages ?? []).map((m, i) => {
            const isMe = m.sender_id !== caregiverId;
            const prev = messages![i - 1];
            const showDay = !prev || fmtDay(prev.created_at) !== fmtDay(m.created_at);
            return (
              <div key={m.id}>
                {showDay && (
                  <div className="my-2 text-center text-xs text-muted-foreground">{fmtDay(m.created_at)}</div>
                )}
                <div className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm ${
                      isMe ? "bg-primary text-primary-foreground" : "bg-muted"
                    }`}
                  >
                    <div className="whitespace-pre-wrap break-words">{m.body}</div>
                    <div className={`mt-1 text-[10px] ${isMe ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                      {fmtTime(m.created_at)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      <div className="flex items-end gap-2 border-t p-3">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Napisz wiadomość..."
          rows={1}
          className="max-h-32 min-h-[40px] resize-none"
        />
        <Button size="icon" onClick={handleSend} disabled={sendMut.isPending || !draft.trim()}>
          {sendMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
