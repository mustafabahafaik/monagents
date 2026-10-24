import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import Dashboard from "./App.jsx";
import Landing from "./Landing.jsx";
import "./styles.css";
import "./landing.css";

function Router() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash.startsWith("#/dashboard") ? <Dashboard /> : <Landing />;
}

createRoot(document.getElementById("root")).render(<Router />);
