const jwt = require("jsonwebtoken")
const mongoose = require("mongoose")

// MongoDB connection
let cachedConnection = null

async function connectToDatabase() {
  if (cachedConnection) {
    return cachedConnection
  }

  try {
    const connection = await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    })
    cachedConnection = connection
    return connection
  } catch (error) {
    console.error("Database connection error:", error)
    throw error
  }
}

// User Schema
const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: {
      type: String,
      required: function () {
        return !this.googleId
      },
    },
    dateOfBirth: {
      type: Date,
      required: function () {
        return !this.googleId
      },
    },
    googleId: { type: String, sparse: true },
    isVerified: { type: Boolean, default: false },
    otp: {
      code: String,
      expiresAt: Date,
    },
  },
  { timestamps: true },
)

const User = mongoose.models.User || mongoose.model("User", userSchema)

// Note Schema
const noteSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    content: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
)

const Note = mongoose.models.Note || mongoose.model("Note", noteSchema)

// Middleware to verify JWT token
const authenticateToken = async (req) => {
  const authHeader = req.headers["authorization"]
  const token = authHeader && authHeader.split(" ")[1]

  if (!token) {
    throw new Error("Access token required")
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    const user = await User.findById(decoded.userId).select("-password -otp")

    if (!user) {
      throw new Error("Invalid token")
    }

    return user
  } catch (error) {
    throw new Error("Invalid or expired token")
  }
}

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader("Access-Control-Allow-Credentials", true)
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT")
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization",
  )

  if (req.method === "OPTIONS") {
    res.status(200).end()
    return
  }

  try {
    await connectToDatabase()

    // Authenticate user
    const user = await authenticateToken(req)
    const { id } = req.query

    if (req.method === "DELETE") {
      // Delete a note
      const note = await Note.findOneAndDelete({ _id: id, userId: user._id })
      if (!note) {
        return res.status(404).json({ message: "Note not found" })
      }

      return res.status(200).json({ message: "Note deleted successfully" })
    }

    if (req.method === "PUT") {
      // Update a note
      const { title, content } = req.body

      if (!title || !content) {
        return res.status(400).json({ message: "Title and content are required" })
      }

      const note = await Note.findOne({ _id: id, userId: user._id })
      if (!note) {
        return res.status(404).json({ message: "Note not found" })
      }

      note.title = title.trim()
      note.content = content.trim()
      await note.save()

      return res.status(200).json({
        message: "Note updated successfully",
        note: {
          id: note._id,
          title: note.title,
          content: note.content,
          createdAt: note.createdAt,
          updatedAt: note.updatedAt,
        },
      })
    }

    return res.status(405).json({ message: "Method not allowed" })
  } catch (error) {
    console.error("Note operation error:", error)
    if (error.message.includes("token")) {
      return res.status(401).json({ message: error.message })
    }
    res.status(500).json({ message: "Internal server error" })
  }
}
