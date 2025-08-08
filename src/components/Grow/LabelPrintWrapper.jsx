// src/components/Grow/LabelPrintWrapper.jsx
import React from "react";
import LabelPrint from "./LabelPrint";

export default function LabelPrintWrapper({ grows = [], prefs = {} }) {
  return <LabelPrint grows={Array.isArray(grows) ? grows : []} prefs={prefs} />;
}
