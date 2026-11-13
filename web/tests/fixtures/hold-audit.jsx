import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { HoldButton } from "../../src/components/HoldButton.jsx";
function App() { const [count, setCount] = useState(0); return <><HoldButton onConfirm={() => setCount(n => n + 1)}>Delete</HoldButton><output>{count}</output></>; }
createRoot(document.getElementById("root")).render(<App />);
