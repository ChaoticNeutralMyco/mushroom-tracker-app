export default function MushroomCard({ name, description }) {
  return (
    <div className="bg-white rounded-lg shadow p-4 m-2 max-w-sm">
      <h2 className="text-xl font-semibold mb-2">{name}</h2>
      <p className="text-gray-700">{description}</p>
    </div>
  );
}
