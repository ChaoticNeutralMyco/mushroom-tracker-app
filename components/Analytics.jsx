import React from "react";

export default function Analytics({ grows }) {
  const total = grows.length;
  const byStage = grows.reduce((acc, g) => {
    acc[g.stage] = (acc[g.stage] || 0) + 1;
    return acc;
  }, {});
  return (
    <div className="my-4 p-4 border rounded bg-white shadow">
      <h2 className="text-xl font-bold">Analytics</h2>
      <p>Total Grows: {total}</p>
      {Object.entries(byStage).map(([stage, count]) => (
        <p key={stage}>{stage}: {count}</p>
      ))}
    </div>
  );
}
