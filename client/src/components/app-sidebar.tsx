import {
  Activity,
  BicepsFlexed,
  Banknote,
  CalendarDays,
  ContactRound,
  Database,
  Filter,
  GraduationCap,
  History,
  LayoutDashboard,
  LineChart,
  ListChecks,
  ClipboardCheck,
  Boxes,
  Building2,
  Check,
  ChevronsUpDown,
  LogOut,
  ListTree,
  PhoneCall,
  UserCog,
  Users,
  Wallet,
  WalletCards,
  SlidersHorizontal,
  MapPin,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { ShiftReportsAttentionBadge } from '@/components/shift-reports-attention-badge';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  SidebarSeparator,
} from '@/components/ui/sidebar';
import { Link, useLocation } from 'react-router-dom';
import {
  canAccessPathForAuthority,
  type ClientRoute,
} from '@/lib/permissions';
import { useAuth } from '@/lib/useAuth';
import { selectAuthorizationRole } from '@/lib/authorization';
import { getAccountRoleLabel } from '@/lib/roles';
import { cn } from '@/lib/utils';
import { ThemeToggle } from './theme-toggle';
import { BrandMark } from './brand-mark';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type {
  TenantDiscoveryResponse,
  ActiveTenantContext,
} from '@/lib/tenant-context';

type NavItem = {
  title: string;
  url?: ClientRoute;
  authorizationPath?: ClientRoute;
  icon: LucideIcon;
  activeUrls?: string[];
  badge?:
    | { kind: 'static'; label: string }
    | { kind: 'shiftReports' };
  disabled?: boolean;
  tooltip?: string;
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
      {
        title: 'Смена',
        url: '/admin/shift/motivation',
        activeUrls: ['/admin/shift'],
        icon: Banknote,
        badge: { kind: 'shiftReports' },
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
    ],
  },
  {
    title: 'Предоплаты и деньги',
    items: [
      {
        title: 'Предоплаты',
        url: '/admin/prepayments',
        icon: WalletCards,
        activeUrls: [
          '/admin/prepayments',
          '/admin/certificates',
          '/admin/corporate-clients',
        ],
      },
      {
        title: 'Финансы (P&L)',
        url: '/admin/finances',
        icon: Wallet,
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
        activeUrls: ['/admin/methodology', '/admin/methodology-analytics'],
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
        title: 'Настройки смены',
        url: '/admin/shift-settings',
        icon: SlidersHorizontal,
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
        title: 'Справочник товаров',
        url: '/admin/catalog',
        icon: Database,
      },
      {
        title: 'Инвентаризация',
        icon: Boxes,
        badge: { kind: 'static', label: 'Скоро' },
        disabled: true,
        authorizationPath: '/admin/catalog',
        tooltip: 'Раздел в разработке',
      },
      {
        title: 'Справочники CRM',
        url: '/admin/references',
        icon: ListTree,
      },
    ],
  },
];

function isRouteActive(currentPath: string, item: NavItem) {
  if (item.disabled || !item.url) return false;

  const urls = item.activeUrls || [item.url];

  return urls.some(
    (url) =>
      currentPath === url || (url !== '/admin' && currentPath.startsWith(`${url}/`)),
  );
}

function ShiftReportsBadge() {
  return <ShiftReportsAttentionBadge placement="sidebar" />;
}

function NavigationBadge({ badge }: { badge: NonNullable<NavItem['badge']> }) {
  if (badge.kind === 'shiftReports') return <ShiftReportsBadge />;

  return (
    <SidebarMenuBadge className="bg-sidebar-accent/70 text-[10px] text-sidebar-foreground/60">
      {badge.label}
    </SidebarMenuBadge>
  );
}

function TenantSwitcher({
  context,
  discovery,
  onSwitch,
}: {
  context: ActiveTenantContext;
  discovery: TenantDiscoveryResponse;
  onSwitch: (organizationId: number, clubId: number) => Promise<void>;
}) {
  const activeMembership = discovery.memberships.find(
    (membership) => membership.id === context.membershipId,
  );
  const activeClub = activeMembership?.clubs.find((club) => club.id === context.clubId);

  if (!activeMembership || !activeClub) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Сменить организацию или клуб. Сейчас ${activeMembership.organization.name}, ${activeClub.name}`}
          className="group mt-3 flex w-full min-w-0 items-center gap-2.5 rounded-xl border border-sidebar-border/80 bg-sidebar-accent/35 px-3 py-2.5 text-left shadow-sm shadow-foreground/5 outline-none transition hover:bg-sidebar-accent/65 focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background/75 text-primary ring-1 ring-sidebar-border/70">
            <Building2 className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span
              className="block truncate text-[11px] font-medium uppercase tracking-wide text-sidebar-foreground/55"
              title={activeMembership.organization.name}
            >
              {activeMembership.organization.name}
            </span>
            <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm font-semibold text-sidebar-foreground">
              <MapPin className="size-3.5 shrink-0 text-primary/75" />
              <span className="truncate" title={activeClub.name}>{activeClub.name}</span>
            </span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-sidebar-foreground/55 transition group-hover:text-sidebar-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={8}
        className="max-h-[min(70vh,34rem)] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-xl p-1.5"
      >
        <DropdownMenuLabel className="px-2.5 py-2 text-[11px] uppercase tracking-wide">
          Выберите рабочий клуб
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {discovery.memberships.map((membership, index) => (
          <DropdownMenuGroup key={membership.id}>
            {index > 0 ? <DropdownMenuSeparator className="my-1.5" /> : null}
            <DropdownMenuLabel className="flex items-center gap-2 px-2.5 pb-1 pt-2 text-xs text-foreground">
              <Building2 className="size-3.5 text-muted-foreground" />
              <span className="truncate" title={membership.organization.name}>
                {membership.organization.name}
              </span>
            </DropdownMenuLabel>
            {membership.clubs.map((club) => {
              const active =
                membership.id === context.membershipId && club.id === context.clubId;
              return (
                <DropdownMenuItem
                  key={`${membership.id}:${club.id}`}
                  aria-current={active ? 'true' : undefined}
                  className="min-h-11 rounded-lg px-2.5 py-2"
                  onSelect={() => {
                    if (!active) {
                      void onSwitch(membership.organization.id, club.id);
                    }
                  }}
                >
                  <MapPin className="size-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium" title={club.name}>
                      {club.name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {getAccountRoleLabel(club.effectiveRole)}
                    </span>
                  </span>
                  {active ? <Check className="size-4 text-primary" /> : null}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppSidebar() {
  const location = useLocation();
  const {
    account,
    logout,
    tenantContext,
    tenantDiscovery,
    tenantContextEnabled,
    switchTenantContext,
  } = useAuth();
  const authority = {
    accountRole: account?.role,
    tenantContext,
    tenantContextEnabled,
  };
  const navRef = useRef<HTMLDivElement | null>(null);
  const [activeIndicator, setActiveIndicator] = useState({
    height: 0,
    left: 0,
    opacity: 0,
    top: 0,
    width: 0,
  });
  const availableSections = navigationSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        const path = item.authorizationPath || item.url;
        return path ? canAccessPathForAuthority(authority, path) : false;
      }),
    }))
    .filter((section) => section.items.length > 0);
  const displayName = account?.Staff?.name || account?.email || 'Аккаунт';
  const secondaryLabel = account?.Staff?.name
    ? account.email
    : getAccountRoleLabel(selectAuthorizationRole(authority, 'membership'));
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
  const syncActiveIndicator = useCallback(() => {
    const root = navRef.current;
    const activeItem = root?.querySelector<HTMLElement>(
      '[data-sidebar-nav-item="true"][data-active="true"]',
    );

    if (!root || !activeItem) {
      setActiveIndicator((current) => ({ ...current, opacity: 0 }));
      return;
    }

    const rootRect = root.getBoundingClientRect();
    const itemRect = activeItem.getBoundingClientRect();

    setActiveIndicator({
      height: itemRect.height,
      left: itemRect.left - rootRect.left,
      opacity: 1,
      top: itemRect.top - rootRect.top,
      width: itemRect.width,
    });
  }, []);

  useLayoutEffect(() => {
    const frame = window.requestAnimationFrame(syncActiveIndicator);
    const root = navRef.current;
    const observer = new ResizeObserver(syncActiveIndicator);

    if (root) observer.observe(root);
    window.addEventListener('resize', syncActiveIndicator);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', syncActiveIndicator);
    };
  }, [location.pathname, syncActiveIndicator, availableSections.length]);

  return (
    <Sidebar collapsible="none">
      <SidebarHeader className="border-b border-sidebar-border/70 p-4 pb-3">
        <div className="flex h-10 min-w-0 items-center gap-3">
          <BrandMark className="size-9" decorative />
          <span className="block min-w-0 truncate text-sm font-semibold tracking-tight text-primary">
            Setly
          </span>
          <ThemeToggle />
        </div>
        {tenantContextEnabled && tenantContext && tenantDiscovery ? (
          <TenantSwitcher
            context={tenantContext}
            discovery={tenantDiscovery}
            onSwitch={switchTenantContext}
          />
        ) : null}
      </SidebarHeader>

      <SidebarContent>
        <div ref={navRef} className="relative px-1 py-1">
          <div
            aria-hidden="true"
            data-sidebar-active-indicator="true"
            className="pointer-events-none absolute left-0 top-0 z-0 rounded-xl bg-sidebar-accent shadow-sm shadow-foreground/5 ring-1 ring-sidebar-border/60 transition-[height,opacity,transform,width] duration-300 ease-out"
            style={{
              height: activeIndicator.height,
              opacity: activeIndicator.opacity,
              transform: `translate3d(${activeIndicator.left}px, ${activeIndicator.top}px, 0)`,
              width: activeIndicator.width,
            }}
          />
          {availableSections.map((section, sectionIndex) => {
            const isSectionActive = section.items.some((item) =>
              isRouteActive(location.pathname, item),
            );

            return (
              <SidebarGroup
                key={section.title}
                className={cn(
                  'relative z-10 border-t border-sidebar-border/45 py-1.5 transition-[background-color,border-color,box-shadow] duration-300 ease-out first:border-t-0 group-data-[collapsible=icon]:py-0',
                  sectionIndex > 0 && 'mt-1',
                  isSectionActive &&
                    'rounded-2xl bg-sidebar-accent/30 shadow-[inset_0_1px_0_hsl(var(--sidebar-border)/0.45)]',
                )}
              >
                <SidebarGroupLabel
                  className={cn(
                    isSectionActive && 'text-sidebar-foreground/85',
                  )}
                >
                  {section.title}
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {section.items.map((item) => {
                      const isActive = isRouteActive(location.pathname, item);

                      if (item.disabled) {
                        return (
                          <SidebarMenuItem
                            key={item.title}
                            title={item.tooltip}
                          >
                            <SidebarMenuButton
                              aria-disabled="true"
                              className="cursor-not-allowed pr-14 text-sidebar-foreground/55 hover:bg-transparent hover:text-sidebar-foreground/55 disabled:pointer-events-none disabled:opacity-100"
                              disabled
                              tabIndex={-1}
                            >
                              <item.icon />
                              <span>{item.title}</span>
                            </SidebarMenuButton>
                            {item.badge ? <NavigationBadge badge={item.badge} /> : null}
                          </SidebarMenuItem>
                        );
                      }

                      return (
                        <SidebarMenuItem key={item.url}>
                          <SidebarMenuButton
                            asChild
                            className={item.badge ? 'pr-10' : undefined}
                            data-sidebar-nav-item="true"
                            isActive={isActive}
                          >
                            <Link to={item.url!}>
                              <item.icon />
                              <span>{item.title}</span>
                            </Link>
                          </SidebarMenuButton>
                          {item.badge ? <NavigationBadge badge={item.badge} /> : null}
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            );
          })}
        </div>
      </SidebarContent>

      <SidebarSeparator className="mx-4" />
      <SidebarFooter className="p-4 pt-3 group-data-[collapsible=icon]:items-center">
        <SidebarMenu>
          <SidebarMenuItem className="group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center">
            <SidebarMenuButton
              size="lg"
              className="cursor-default hover:bg-transparent hover:text-sidebar-foreground group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:overflow-visible"
            >
              <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-sidebar-accent text-xs font-semibold group-data-[collapsible=icon]:size-7 group-data-[collapsible=icon]:text-[11px]">
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
            <SidebarMenuButton onClick={logout}>
              <LogOut />
              <span>Выйти</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
