import {
  Activity,
  BicepsFlexed,
  Database,
  LayoutDashboard,
  LineChart,
  Target,
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
} from '@/components/ui/sidebar';
import { Link, useLocation } from 'react-router-dom';

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

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="h-16 flex items-center justify-center border-b border-sidebar-border px-4">
        <span className="font-bold text-xl tracking-tight text-primary truncate group-data-[collapsible=icon]:hidden w-full">
          Padel Park
        </span>
        <span className="font-bold text-xl tracking-tight text-primary hidden group-data-[collapsible=icon]:block">
          PP
        </span>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Администрирование</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
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
    </Sidebar>
  );
}
