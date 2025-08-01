import React from "react";
import GrowForm from "./GrowForm";
import GrowList from "./GrowList";
import LogoutButton from "./LogoutButton";
import { useAuth } from "../context/AuthContext";

const Dashboard = () => {
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-white p-4">
      <header className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Mushroom Tracker Dashboard</h1>
        <div className="flex items-center gap-4">
          <p className="text-sm">Logged in as: {user?.email}</p>
          <LogoutButton />
        </div>
      </header>

      <main className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section className="bg-white dark:bg-gray-800 p-4 rounded shadow">
          <h2 className="text-xl font-semibold mb-2">Add / Edit Grow</h2>
          <GrowForm />
        </section>

        <section className="bg-white dark:bg-gray-800 p-4 rounded shadow">
          <h2 className="text-xl font-semibold mb-2">Your Grows</h2>
          <GrowList />
        </section>
      </main>
    </div>
  );
};

export default Dashboard;
