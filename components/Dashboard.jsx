import React from "react";
import { useAuth } from "../context/AuthContext";
import LogoutButton from "./LogoutButton";
import GrowList from "./GrowList"; // Optional
import GrowForm from "./GrowForm"; // Optional

const Dashboard = () => {
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="max-w-3xl mx-auto bg-white shadow-md rounded-lg p-6">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-2xl font-bold">
            Welcome, {user?.email || "User"} 👋
          </h1>
          <LogoutButton />
        </div>

        <div className="space-y-6">
          <GrowForm />
          <GrowList />
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
