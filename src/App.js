import React from "react";
import { BrowserRouter as Router, Routes, Route, NavLink } from "react-router-dom";

import Home from "./pages/Home";
import Search from "./pages/Search";

export default function App() {
  return (
    <Router>
      <div className="app">
        <div className="flex items-center justify-between px-6 py-4 bg-white shadow-sm">
          <h2 className="text-lg font-bold text-indigo-600">GitScan</h2>
          <nav className="flex gap-1">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  isActive ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:text-gray-900'
                }`
              }
            >
              Users
            </NavLink>
            <NavLink
              to="/search"
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  isActive ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:text-gray-900'
                }`
              }
            >
              Search
            </NavLink>
          </nav>
        </div>

        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/search" element={<Search />} />
        </Routes>
      </div>
    </Router>
  );
}
