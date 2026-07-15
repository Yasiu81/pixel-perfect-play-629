import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard, Users, CalendarClock,
  FileBarChart, LogOut, UserCog, History, Settings, MessageCircle,
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarFooter,
  SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { supabase } from "@/integrations/supabase/client";

const mainItems = [
  { title: "Pulpit",        url: "/pulpit",      icon: LayoutDashboard },
  { title: "Opiekunowie",   url: "/opiekunowie", icon: UserCog },
  { title: "Seniorzy",      url: "/seniorzy",    icon: Users },
  { title: "Monitor wizyt", url: "/wizyty",      icon: CalendarClock },
  { title: "Czat",          url: "/czat",        icon: MessageCircle },
  { title: "Raporty",       url: "/raporty",     icon: FileBarChart },
];

const bottomItems = [
  { title: "Historia logowania", url: "/historia", icon: History,  disabled: false },
  { title: "Ustawienia",         url: "/ustawienia", icon: Settings, disabled: false },
];

export function CoordinatorSidebar() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const { data: unreadCount } = useQuery({
    queryKey: ["messages-unread-count"],
    queryFn: async () => {
      const { data } = await supabase
        .from("messages")
        .select("sender_id, caregiver_id")
        .is("read_at", null)
        .limit(500);
      // Liczymy tylko wiadomości OD opiekuna (sender_id = caregiver_id wątku) —
      // PostgREST nie porównuje dwóch kolumn bezpośrednio, więc filtrujemy w JS.
      return (data ?? []).filter((m: { sender_id: string; caregiver_id: string }) => m.sender_id === m.caregiver_id).length;
    },
    refetchInterval: 20_000,
  });

  async function handleLogout() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-2 px-2 py-2">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground font-semibold text-sm">
            PS
          </div>
          <div className="flex flex-col leading-tight group-data-[collapsible=icon]:hidden">
            <span className="text-sm font-semibold text-sidebar-foreground">Plan Seniora</span>
            <span className="text-xs text-sidebar-foreground/70">Panel koordynatora</span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Nawigacja</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainItems.map((item) => {
                const active = pathname === item.url || pathname.startsWith(item.url + "/");
                return (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
                      <Link to={item.url} className="relative">
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                        {item.url === "/czat" && !!unreadCount && unreadCount > 0 && (
                          <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                            {unreadCount > 9 ? "9+" : unreadCount}
                          </span>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator />

        <SidebarGroup>
          <SidebarGroupLabel>Konto</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {bottomItems.map((item) => (
                <SidebarMenuItem key={item.url}>
                  {item.disabled ? (
                    <SidebarMenuButton
                      tooltip={item.title}
                      className="opacity-50 cursor-not-allowed"
                      disabled
                    >
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  ) : (
                    <SidebarMenuButton
                      asChild
                      isActive={pathname === item.url || pathname.startsWith(item.url + "/")}
                      tooltip={item.title}
                    >
                      <Link to={item.url}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  )}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={handleLogout} tooltip="Wyloguj">
              <LogOut className="h-4 w-4" />
              <span>Wyloguj</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
