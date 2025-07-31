import React, { useState } from "react";

export default function GrowForm({ setGrows }) {
  const [form, setForm] = useState({
    strain: "",
    stage: "Inoculation",
    cost: "",
    yield: ""
  });

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setGrows((prev) => [...prev, { ...form, id: Date.now() }]);
    setForm({ strain: "", stage: "Inoculation", cost: "", yield: "" });
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 p-4 rounded shadow mb-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <input
          name="strain"
          placeholder="Strain"
          value={form.strain}
          onChange={handleChange}
          className="p-2 border rounded"
          required
        />
        <select
          name="stage"
          value={form.stage}
          onChange={handleChange}
          className="p-2 border rounded"
        >
          <option>Inoculation</option>
          <option>Colonization</option>
          <option>Fruiting</option>
          <option>Harvested</option>
        </select>
        <input
          name="cost"
          placeholder="Cost"
          value={form.cost}
          onChange={handleChange}
          className="p-2 border rounded"
        />
        <input
          name="yield"
          placeholder="Yield"
          value={form.yield}
          onChange={handleChange}
          className="p-2 border rounded"
        />
      </div>
      <button
        type="submit"
        className="mt-4 bg-blue-500 text-white px-4 py-2 rounded"
      >
        Add Grow
      </button>
    </form>
  );
}
