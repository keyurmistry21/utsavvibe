// d = SVG path (24x24 stroke icons)
export const icons = {
  home: "M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10",
  orders: "M4 4h16v12h-5l-1 3h-4l-1-3H4zM4 12h5l1 2h4l1-2h5",
  products: "M3 12l9-9h8v8l-9 9zM15.5 8.5h.01",
  customers: "M16 20v-1a4 4 0 00-4-4H8a4 4 0 00-4 4v1M10 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7M20 20v-1a4 4 0 00-3-3.9M16 4.2a3.5 3.5 0 010 6.6",
  markets: "M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18",
  analytics: "M4 20V10M10 20V4M16 20v-8M22 20H2",
  settings: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z",
  out: "M9 4H5v16h4M16 8l4 4-4 4M20 12H9",
  search: "M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3",
} as const;

export const links = [
  { href: "/admin", label: "Home", icon: icons.home },
  { href: "/admin/orders", label: "Orders", icon: icons.orders },
  { href: "/admin/products", label: "Products", icon: icons.products },
  { href: "/admin/customers", label: "Customers", icon: icons.customers },
  { href: "/admin/markets", label: "Markets", icon: icons.markets },
  { href: "/admin/analytics", label: "Analytics", icon: icons.analytics },
] as const;

// things the search / finder can jump to
export const actions = [
  ...links.map((l) => ({ label: l.label, href: l.href })),
  { label: "Add product", href: "/admin/products?new=1" },
  { label: "Print product labels", href: "/admin/products/labels" },
  { label: "Add market", href: "/admin/markets?new=1" },
  { label: "Open orders to fulfil", href: "/admin/orders?status=open" },
  { label: "Settings / change password", href: "/admin/settings" },
];
