import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  // We initialize with a default to match SSR, and then update in useEffect
  // after reading the actual DOM state set by the head script.
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const isLight = document.documentElement.classList.contains("light");
    setTheme(isLight ? "light" : "dark");
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === "light" ? "dark" : "light";
    setTheme(newTheme);
    if (newTheme === "light") {
      document.documentElement.classList.add("light");
    } else {
      document.documentElement.classList.remove("light");
    }
    localStorage.setItem("theme", newTheme);
  };

  // Prevent hydration mismatch by rendering a placeholder until mounted
  if (!mounted) {
    return (
      <button
        type="button"
        className="btn btn-sm px-2 w-8"
        aria-label="Toggle theme"
        title="Toggle theme"
        disabled
      >
        <span className="w-3.5 h-3.5" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="btn btn-sm px-2 w-8"
      aria-label="Toggle theme"
      title="Toggle theme"
    >
      {theme === "light" ? <Moon size={14} /> : <Sun size={14} />}
    </button>
  );
}
