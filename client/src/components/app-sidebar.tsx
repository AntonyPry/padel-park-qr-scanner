import {
  Activity,
  BicepsFlexed,
  Building2,
  CalendarDays,
  CircleDollarSign,
  ContactRound,
  Database,
  Filter,
  Gift,
  GraduationCap,
  History,
  LayoutDashboard,
  ListChecks,
  ChartColumn,
  ClipboardCheck,
  LineChart,
  LogOut,
  ListTree,
  PhoneCall,
  PhoneIncoming,
  UserCog,
  Users,
  Wallet,
  WalletCards,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
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

type NavItem = {
  title: string;
  url: string;
  icon: LucideIcon;
};

type NavSection = {
  title: string;
  items: NavItem[];
};

const navigationSections: NavSection[] = [
  {
    title: 'Рабочий день',
    items: [
      {
        title: 'Монитор входов',
        url: '/admin',
        icon: LayoutDashboard,
      },
      {
        title: 'Клиенты',
        url: '/admin/clients',
        icon: ContactRound,
      },
      {
        title: 'Бронирование',
        url: '/admin/bookings',
        icon: CalendarDays,
      },
      {
        title: 'Тренерский кабинет',
        url: '/admin/trainer',
        icon: BicepsFlexed,
      },
      {
        title: 'Обучение',
        url: '/admin/onboarding',
        icon: GraduationCap,
      },
    ],
  },
  {
    title: 'CRM и коммуникации',
    items: [
      {
        title: 'Базы клиентов',
        url: '/admin/client-bases',
        icon: Filter,
      },
      {
        title: 'Задачи обзвона',
        url: '/admin/call-tasks',
        icon: PhoneCall,
      },
      {
        title: 'Телефония',
        url: '/admin/telephony',
        icon: PhoneIncoming,
      },
    ],
  },
  {
    title: 'Предоплаты и деньги',
    items: [
      {
        title: 'Предоплаты',
        url: '/admin/prepayments',
        icon: WalletCards,
      },
      {
        title: 'Сертификаты',
        url: '/admin/certificates',
        icon: Gift,
      },
      {
        title: 'Корпоративные клиенты',
        url: '/admin/corporate-clients',
        icon: Building2,
      },
      {
        title: 'Финансы (P&L)',
        url: '/admin/finances',
        icon: Wallet,
      },
      {
        title: 'Мотивация',
        url: '/admin/motivation',
        icon: CircleDollarSign,
      },
    ],
  },
  {
    title: 'Методическая работа',
    items: [
      {
        title: 'Методика',
        url: '/admin/methodology',
        icon: ListChecks,
      },
      {
        title: 'Аналитика методики',
        url: '/admin/methodology-analytics',
        icon: ChartColumn,
      },
    ],
  },
  {
    title: 'Аналитика и контроль',
    items: [
      {
        title: 'Контроль менеджера',
        url: '/admin/manager-control',
        icon: ClipboardCheck,
      },
      {
        title: 'Аналитика входов',
        url: '/admin/visits-analytics',
        icon: LineChart,
      },
      {
        title: 'Утилизация кортов',
        url: '/admin/utilization',
        icon: Activity,
      },
      {
        title: 'Журнал действий',
        url: '/admin/audit',
        icon: History,
      },
    ],
  },
  {
    title: 'Настройки',
    items: [
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
        title: 'Справочник товаров',
        url: '/admin/catalog',
        icon: Database,
      },
      {
        title: 'Справочники CRM',
        url: '/admin/references',
        icon: ListTree,
      },
    ],
  },
];

function isRouteActive(currentPath: string, itemUrl: string) {
  return (
    currentPath === itemUrl ||
    (itemUrl !== '/admin' && currentPath.startsWith(`${itemUrl}/`))
  );
}

export function AppSidebar() {
  const location = useLocation();
  const { account, logout } = useAuth();
  const availableSections = navigationSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) =>
        hasRoleAccess(account?.role, ROUTE_ACCESS[item.url] || []),
      ),
    }))
    .filter((section) => section.items.length > 0);
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
        {availableSections.map((section) => (
          <SidebarGroup
            key={section.title}
            className="py-1 group-data-[collapsible=icon]:py-0"
          >
            <SidebarGroupLabel>{section.title}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton
                      asChild
                      isActive={isRouteActive(location.pathname, item.url)}
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
        ))}
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
