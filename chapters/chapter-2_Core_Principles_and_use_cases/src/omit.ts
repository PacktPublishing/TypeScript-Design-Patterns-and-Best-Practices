interface User {
  name: string
  email: string
  password: string
  confirmPassword: string
  bio?: string // Optional user bio
  location?: string // Optional user location
}

// Expected form data
type UserInput = Pick<User, "name" | "email" | "password" | "confirmPassword">
// Excludes unnecessary properties
type ProcessedUserData = Omit<User, "confirmPassword" | "bio" | "location">
