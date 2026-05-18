import {
  Activity,
  BicepsFlexed,
  ContactRound,
  Database,
  LayoutDashboard,
  LineChart,
  LogOut,
  UserCog,
  Users,
  Wallet,
} from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  SidebarSeparator,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Link, useLocation } from 'react-router-dom';
import { ROUTE_ACCESS, hasRoleAccess } from '@/lib/permissions';
import { useAuth } from '@/lib/useAuth';
import { getAccountRoleLabel } from '@/lib/roles';

const items = [
  {
    title: 'Монитор входов',
    url: '/admin',
    icon: LayoutDashboard,
  },
  {
    title: 'Аналитика входов',
    url: '/admin/visits-analytics',
    icon: LineChart,
  },
  {
    title: 'Клиенты',
    url: '/admin/clients',
    icon: ContactRound,
  },
  {
    title: 'Финансы (P&L)',
    url: '/admin/finances',
    icon: Wallet,
  },
  {
    title: 'Персонал',
    url: '/admin/staff',
    icon: Users,
  },
  {
    title: 'Пользователи',
    url: '/admin/users',
    icon: UserCog,
  },
  {
    title: 'Мотивацию поднимаем',
    url: '/admin/motivation',
    icon: BicepsFlexed,
  },
  {
    title: 'Утилизация кортов',
    url: '/admin/utilization',
    icon: Activity,
  },
  {
    title: 'Справочник товаров',
    url: '/admin/catalog',
    icon: Database,
  },
];

export function AppSidebar() {
  const location = useLocation();
  const { account, logout } = useAuth();
  const availableItems = items.filter((item) =>
    hasRoleAccess(account?.role, ROUTE_ACCESS[item.url] || []),
  );
  const displayName = account?.Staff?.name || account?.email || 'Аккаунт';
  const secondaryLabel = account?.Staff?.name
    ? account.email
    : getAccountRoleLabel(account?.role);
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border p-2">
        <div className="flex h-10 min-w-0 items-center gap-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-sidebar-border bg-sidebar-accent text-xs font-semibold text-primary group-data-[collapsible=icon]:hidden">
            PP
          </div>
          <span className="min-w-0 flex-1 truncate font-bold tracking-tight text-primary group-data-[collapsible=icon]:hidden">
            Padel Park
          </span>
          <SidebarTrigger className="ml-auto group-data-[collapsible=icon]:mx-auto" />
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Администрирование</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {availableItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={location.pathname === item.url}
                    tooltip={item.title}
                  >
                    <Link to={item.url}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarSeparator />
      <SidebarFooter className="group-data-[collapsible=icon]:items-center">
        <SidebarMenu>
          <SidebarMenuItem className="group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center">
            <SidebarMenuButton
              size="lg"
              className="cursor-default hover:bg-transparent hover:text-sidebar-foreground group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:overflow-visible"
              tooltip={displayName}
            >
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sidebar-accent text-xs font-semibold group-data-[collapsible=icon]:size-7 group-data-[collapsible=icon]:text-[11px]">
                {initials || 'CRM'}
              </div>
              <span className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
                <span className="block truncate font-medium">
                  {displayName}
                </span>
                <span className="block truncate text-xs text-sidebar-foreground/70">
                  {secondaryLabel}
                </span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem className="group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center">
            <SidebarMenuButton onClick={logout} tooltip="Выйти">
              <LogOut />
              <span>Выйти</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
