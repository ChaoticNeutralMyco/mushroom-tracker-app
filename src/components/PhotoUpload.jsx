import React, { useRef } from "react";

export default function PhotoUpload({ growId, photos, onUpload }) {
  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files);
    const photoURLs = files.map((file) => URL.createObjectURL(file));

    // You could store the actual file in state if you want to persist uploads
    onUpload(growId, photoURLs);
  };

  return (
    <div className="bg-white dark:bg-gray-800 p-4 rounded shadow-md mt-4">
      <h3 className="text-lg font-semibold mb-2 text-gray-800 dark:text-white">
        Upload Photos
      </h3>

      <div className="flex items-center space-x-4">
        <input
          type="file"
          multiple
          accept="image/*"
          onChange={handleFileChange}
          ref={fileInputRef}
          className="hidden"
        />
        <button
          onClick={() => fileInputRef.current.click()}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition"
        >
          Select Images
        </button>
      </div>

      {photos && photos.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-4">
          {photos.map((src, index) => (
            <img
              key={index}
              src={src}
              alt={`Grow ${growId} Photo ${index + 1}`}
              className="w-full h-24 object-cover rounded border border-gray-300"
            />
          ))}
        </div>
      )}
    </div>
  );
}
