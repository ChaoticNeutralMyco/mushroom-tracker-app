import React, { useState } from "react";

export default function GrowForm({ onAddGrow }) {
  const [strain, setStrain] = useState("");
  const [stage, setStage] = useState("Spore");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!strain) return;
    onAddGrow({ strain, stage, date: new Date().toISOString() });
    setStrain("");
    setStage("Spore");
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <input
        type="text"
        placeholder="Strain Name"
        value={strain}
        onChange={(e) => setStrain(e.target.value)}
        className="p-2 border rounded w-full"
      />
      <select
        value={stage}
        onChange={(e) => setStage(e.target.value)}
        className="p-2 border rounded w-full"
      >
        <option value="Spore">Spore</option>
        <option value="Colonizing">Colonizing</option>
        <option value="Fruiting">Fruiting</option>
        <option value="Harvested">Harvested</option>
      </select>
      <button type="submit" className="bg-blue-500 text-white px-4 py-2 rounded">
        Add Grow
      </button>
    </form>
  );
}
