import React from "react";

export default function GrowList({ grows }) {
  return (
    <div>
      <h2 className="text-xl font-semibold mb-2">Active Grows</h2>
      {grows.length === 0 ? (
        <p>No grows yet.</p>
      ) : (
        <ul className="space-y-2">
          {grows.map((grow, index) => (
            <li key={index} className="p-2 bg-white rounded shadow">
              <div className="font-bold">{grow.strain}</div>
              <div>Stage: {grow.stage}</div>
              <div>Started: {new Date(grow.date).toLocaleDateString()}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
