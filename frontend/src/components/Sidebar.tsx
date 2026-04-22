import { Link, useLocation } from "react-router-dom";
import { LayoutDashboard, TableProperties, FileUp, Settings, MessageSquareText } from "lucide-react";
import { cn } from "@/lib/utils";

const navigation = [
  { name: "Dashboard",   href: "/",        icon: LayoutDashboard  },
  { name: "Pipeline",    href: "/pipeline", icon: TableProperties  },
  { name: "Import Deal", href: "/import",   icon: FileUp           },
  { name: "Chat",        href: "/chat",     icon: MessageSquareText },
  { name: "Settings",    href: "/settings", icon: Settings         },
];

export function Sidebar() {
  const { pathname } = useLocation();

  return (
    <div className="flex h-screen w-64 flex-col bg-card border-r border-border shadow-sm fixed top-0 left-0">
      <div className="flex h-16 shrink-0 items-center px-6">
        <h1 className="text-xl font-bold tracking-tight text-primary flex items-center gap-2">
          <div className="w-8 h-8 rounded bg-primary flex items-center justify-center text-white">P</div>
          Pipeline AI
        </h1>
      </div>
      <div className="flex flex-1 flex-col overflow-y-auto px-4 py-4">
        <nav className="flex-1 space-y-1">
          {navigation.map((item) => {
            const isActive = pathname === item.href ||
              (pathname.startsWith(item.href) && item.href !== "/");
            return (
              <Link key={item.name} to={item.href}
                className={cn(
                  isActive
                    ? "bg-secondary text-primary font-medium"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  "group flex items-center rounded-xl px-3 py-2.5 text-sm transition-colors duration-200"
                )}>
                <item.icon className={cn(
                  isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
                  "mr-3 h-5 w-5 flex-shrink-0 transition-colors"
                )} />
                {item.name}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="p-4 border-t border-border mt-auto">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold">JD</div>
          <div className="text-sm">
            <p className="font-medium">John Doe</p>
            <p className="text-xs text-muted-foreground">Admin</p>
          </div>
        </div>
      </div>
    </div>
  );
}
