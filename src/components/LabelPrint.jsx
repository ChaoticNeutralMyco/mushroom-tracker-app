import React, { useEffect, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import { useReactToPrint } from "react-to-print";

const labelSizes = {
  "avery-5160": { width: "2.625in", height: "1in" },
  "avery-5163": { width: "4in", height: "2in" },
  "2x4": { width: "4in", height: "2in" },
  "custom": { width: "3.5in", height: "1.5in" },
};

export default function LabelPrint({ grows = [] }) {
  const [selectedFields, setSelectedFields] = useState({
    strain: true,
    stage: true,
    cost: true,
    createdAt: true,
    yield: true,
    stageDates: true,
  });

  const [labelTemplate, setLabelTemplate] = useState("avery-5163");
  const labelRef = useRef();

  const handleToggle = (field) => {
    setSelectedFields((prev) => ({ ...prev, [field]: !prev[field] }));
  };

  useEffect(() => {
    grows.forEach((grow) => {
      const svg = document.getElementById(`barcode-${grow.id}`);
      if (svg && grow.id) {
        JsBarcode(svg, grow.id, {
          format: "CODE128",
          width: 1,
          height: 30,
          displayValue: false,
        });
      }
    });
  }, [grows]);

  const handlePrint = useReactToPrint({
    content: () => labelRef.current,
  });

  const labelStyle = labelSizes[labelTemplate] || labelSizes["custom"];

  return (
    <div className="p-4 space-y-6">
      {/* Controls */}
      <div className="bg-white dark:bg-zinc-900 p-4 rounded-xl shadow max-w-3xl mx-auto print:hidden">
        <h2 className="text-lg font-semibold mb-3 text-zinc-800 dark:text-white">
          🏷️ Batch Label Print
        </h2>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm text-zinc-700 dark:text-zinc-200 mb-4">
          {Object.keys(selectedFields).map((field) => (
            <label key={field} className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={selectedFields[field]}
                onChange={() => handleToggle(field)}
              />
              <span className="capitalize">{field}</span>
            </label>
          ))}
        </div>

        <label className="block text-sm mb-1 font-medium text-zinc-600 dark:text-zinc-300">
          Label Template
        </label>
        <select
          value={labelTemplate}
          onChange={(e) => setLabelTemplate(e.target.value)}
          className="w-full p-2 border rounded dark:bg-zinc-800 dark:text-white"
        >
          <option value="avery-5160">Avery 5160 (2.625in × 1in)</option>
          <option value="avery-5163">Avery 5163 (4in × 2in)</option>
          <option value="2x4">2in × 4in (Shipping)</option>
          <option value="custom">Custom (3.5in × 1.5in)</option>
        </select>

        <button
          onClick={handlePrint}
          className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          🖨️ Print Labels Only
        </button>
      </div>

      {/* Printable Labels */}
      <div
        ref={labelRef}
        className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 justify-items-center"
      >
        {grows.map((grow) => {
          const hasYield =
            grow.stage === "Harvested" &&
            (grow.yieldWet || grow.yieldDry || grow.yieldWet === 0 || grow.yieldDry === 0);
          const hasStages = grow.stageDates && Object.keys(grow.stageDates).length > 0;

          return (
            <div
              key={grow.id}
              className="border border-zinc-300 shadow-sm p-2 print:shadow-none print:border-none print:p-1"
              style={{
                width: labelStyle.width,
                height: labelStyle.height,
              }}
            >
              <div className="text-[10pt] leading-tight">
                {/* Always show logo */}
                <div className="mb-1">
                  <img
                    src="/logo192.png"
                    alt="Chaotic Neutral Mycology Logo"
                    className="h-4"
                    style={{ objectFit: "contain" }}
                  />
                </div>

                {selectedFields.strain && (
                  <div>
                    <strong>Strain:</strong> {grow.strain || "Unnamed"}
                  </div>
                )}
                {selectedFields.stage && (
                  <div>
                    <strong>Stage:</strong> {grow.stage}
                  </div>
                )}
                {selectedFields.cost && typeof grow.cost === "number" && (
                  <div>
                    <strong>Cost:</strong> ${grow.cost.toFixed(2)}
                  </div>
                )}
                {selectedFields.createdAt && grow.createdAt?.seconds && (
                  <div>
                    <strong>Created:</strong>{" "}
                    {new Date(grow.createdAt.seconds * 1000).toLocaleDateString()}
                  </div>
                )}
                {selectedFields.yield && hasYield && (
                  <>
                    {grow.yieldWet !== undefined && (
                      <div>
                        <strong>Wet:</strong> {grow.yieldWet}g
                      </div>
                    )}
                    {grow.yieldDry !== undefined && (
                      <div>
                        <strong>Dry:</strong> {grow.yieldDry}g
                      </div>
                    )}
                  </>
                )}
                {selectedFields.stageDates &&
                  hasStages &&
                  Object.entries(grow.stageDates).map(([stage, date]) => (
                    <div key={stage}>
                      <strong>{stage}:</strong>{" "}
                      {new Date(date).toLocaleDateString()}
                    </div>
                  ))}
              </div>

              {/* Barcode */}
              <svg id={`barcode-${grow.id}`} className="mt-1" />

              {/* Always show footer */}
              <div className="mt-1 text-[8pt] text-zinc-500 text-center">
                Chaotic Neutral Mycology
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
