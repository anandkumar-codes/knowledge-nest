// Native app helpers (saving, opening and sharing files). The website has none; a native app build
// can replace this file with its own implementation.
export const native = null;

// Address people should open in a browser (sign-in links shared over WhatsApp, etc.).
// The Android app runs from its own local address, so the mobile build sets VITE_PUBLIC_URL.
export const publicUrl = () => import.meta.env.VITE_PUBLIC_URL || window.location.origin;
