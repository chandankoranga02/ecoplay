import React, { createContext, useContext, useEffect, useState } from "react";
import bcrypt from "bcryptjs";
import { AuthContextType, AuthResponse, StoredUser, User } from "../types/auth";
import { loginSchema, registerSchema } from "../validators/auth";

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const USERS_KEY = "ecoplay_users";
const CURRENT_USER_KEY = "ecoplay_current_user";

export const AuthProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(CURRENT_USER_KEY);

      if (!stored) return;

      const parsed: User = JSON.parse(stored);

      setUser(parsed);
    } catch (error) {
      console.error("Failed to restore session:", error);
      localStorage.removeItem(CURRENT_USER_KEY);
    }
  }, []);

  const getUsers = (): StoredUser[] => {
    try {
      const users = localStorage.getItem(USERS_KEY);

      return users ? JSON.parse(users) : [];
    } catch (error) {
      console.error("Failed to parse users:", error);
      return [];
    }
  };

  const saveUsers = (users: StoredUser[]) => {
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
  };

  const register = async (
    name: string,
    email: string,
    password: string,
  ): Promise<AuthResponse> => {
    try {
      const validated = registerSchema.safeParse({
        name,
        email,
        password,
      });

      if (!validated.success) {
        return {
          success: false,
          error: validated.error.issues[0]?.message || "Invalid input",
        };
      }

      const users = getUsers();

      const existingUser = users.find(
        (u) => u.email.toLowerCase() === email.toLowerCase(),
      );

      if (existingUser) {
        return {
          success: false,
          error: "Email already exists",
        };
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      const newUser: StoredUser = {
        id: email.toLowerCase().replace(/[^a-z0-9]/g, "-"),
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password: hashedPassword,
      };

      users.push(newUser);

      saveUsers(users);

      const userSession: User = {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
      };

      setUser(userSession);

      localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(userSession));

      return {
        success: true,
        user: userSession,
      };
    } catch (error) {
      console.error("Registration failed:", error);

      return {
        success: false,
        error: "Registration failed",
      };
    }
  };

  const login = async (
    email: string,
    password: string,
  ): Promise<AuthResponse> => {
    try {
      const validated = loginSchema.safeParse({
        email,
        password,
      });

      if (!validated.success) {
        return {
          success: false,
          error: validated.error.issues[0]?.message || "Invalid credentials",
        };
      }

      const users = getUsers();

      const found = users.find(
        (u) => u.email.toLowerCase() === email.toLowerCase(),
      );

      if (!found) {
        return {
          success: false,
          error: "Invalid credentials",
        };
      }

      const passwordMatch = await bcrypt.compare(password, found.password);

      if (!passwordMatch) {
        return {
          success: false,
          error: "Invalid credentials",
        };
      }

      const userSession: User = {
        id: found.id,
        name: found.name,
        email: found.email,
      };
      setUser(userSession);
      localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(userSession));
      return {
        success: true,
        user: userSession,
      };
    } catch (error) {
      console.error("Login failed:", error);
      return {
        success: false,
        error: "Login failed",
      };
    }
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem(CURRENT_USER_KEY);
  };

  const deleteAccount = (email: string) => {
    const users = getUsers();
    const filtered = users.filter((u) => u.email !== email);

    saveUsers(filtered);

    const deletedUser = users.find((u) => u.email === email);

    if (deletedUser) {
      localStorage.removeItem(`ecoplay_state_${deletedUser.id} `);
    }
    if (user?.email === email) {
      logout();
    }
  };

  const getAllUsers = () => {
    return getUsers().map((u) => ({
      email: u.email,
      name: u.name,
    }));
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        login,
        register,
        logout,
        deleteAccount,
        getAllUsers,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }

  return context;
};
