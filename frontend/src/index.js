import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import App from "@/App";

const root = ReactDOM.createRoot(document.getElementById("root"));
// StrictMode отключён - он вызывает двойной запуск useEffect в development,
// что приводит к двойной записи аудио и дублированию chunks
root.render(<App />);
