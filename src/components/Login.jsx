// src/components/Login.jsx
import React, { useState } from "react";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from "firebase/auth";
import { auth } from "../firebase";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isNewUser, setIsNewUser] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (isNewUser) {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-r from-green-200 to-green-500">
      <form onSubmit={handleSubmit} className="bg-white p-6 rounded-lg shadow-lg w-80 space-y-4">
        <h2 className="text-xl font-semibold text-center">
          {isNewUser ? "Sign Up" : "Login"}
        </h2>
        <input
          type="email"
          className="w-full border rounded px-3 py-2"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          className="w-full border rounded px-3 py-2"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <button
          type="submit"
          className="w-full bg-green-600 text-white py-2 rounded hover:bg-green-700"
        >
          {isNewUser ? "Create Account" : "Login"}
        </button>
        <p
          onClick={() => setIsNewUser(!isNewUser)}
          className="text-sm text-center text-blue-600 cursor-pointer"
        >
          {isNewUser ? "Already have an account? Login" : "New here? Create an account"}
        </p>
      </form>
    </div>
  );
}
