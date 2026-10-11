import os
from datetime import date
from typing import Optional

import jwt
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from auth import hash_password, verify_password, create_access_token, decode_access_token
from database import Base, engine, SessionLocal
from models import Task, User

ADMIN_EMAIL = os.getenv("TASKFORGE_ADMIN_EMAIL", "ysameerkumaary@gmail.com").strip().lower()

app = FastAPI(title="TaskForge API", version="2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

bearer_scheme = HTTPBearer(auto_error=False)


def migrate_database():
    """Add new columns to an existing SQLite database without deleting rows."""
    Base.metadata.create_all(bind=engine)
    inspector = inspect(engine)
    tables = inspector.get_table_names()

    with engine.begin() as connection:
        if "users" in tables:
            user_columns = {column["name"] for column in inspect(engine).get_columns("users")}
            if "role" not in user_columns:
                connection.execute(text("ALTER TABLE users ADD COLUMN role VARCHAR DEFAULT 'member' NOT NULL"))
        if "tasks" in tables:
            task_columns = {column["name"] for column in inspect(engine).get_columns("tasks")}
            additions = {
                "user_id": "INTEGER REFERENCES users(id)",
                "assigned_to": "INTEGER REFERENCES users(id)",
                "due_date": "DATE",
                "progress": "INTEGER DEFAULT 0 NOT NULL",
            }
            for name, definition in additions.items():
                if name not in task_columns:
                    connection.execute(text(f"ALTER TABLE tasks ADD COLUMN {name} {definition}"))
            connection.execute(text("UPDATE tasks SET progress = 100 WHERE completed = 1"))
            connection.execute(text("UPDATE tasks SET status = 'Done' WHERE completed = 1"))
        # The configured email is the sole admin identity.
        if "users" in tables:
            connection.execute(
                text("UPDATE users SET role = CASE WHEN lower(email) = :email THEN 'admin' ELSE 'member' END"),
                {"email": ADMIN_EMAIL},
            )


@app.on_event("startup")
def startup():
    migrate_database()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if not credentials:
        raise HTTPException(status_code=401, detail="Please log in.")
    try:
        user_id = decode_access_token(credentials.credentials)
    except (jwt.InvalidTokenError, ValueError, TypeError, KeyError):
        raise HTTPException(status_code=401, detail="Your session has expired. Please log in again.")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="User account not found.")
    # Always derive the admin role from the configured email, not from frontend state.
    user.role = "admin" if user.email.lower() == ADMIN_EMAIL else "member"
    return user


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.email.lower() != ADMIN_EMAIL or current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required.")
    return current_user


class RegisterInput(BaseModel):
    username: str = Field(min_length=2, max_length=80)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class LoginInput(BaseModel):
    # Accept email-based login and older username-based frontend forms.
    email: Optional[EmailStr] = None
    username: Optional[str] = None
    password: str



class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=5000)
    priority: str = Field(default="Medium")
    due_date: Optional[date] = None
    assigned_to: Optional[int] = None


class TaskUpdate(BaseModel):
    status: Optional[str] = None
    progress: Optional[int] = Field(default=None, ge=0, le=100)


class TaskAdminUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=5000)
    priority: Optional[str] = None
    due_date: Optional[date] = None
    assigned_to: Optional[int] = None
    status: Optional[str] = None
    progress: Optional[int] = Field(default=None, ge=0, le=100)


def task_to_dict(task: Task, db: Session):
    assignee = db.query(User).filter(User.id == task.assigned_to).first() if task.assigned_to else None
    creator = db.query(User).filter(User.id == task.user_id).first() if task.user_id else None
    return {
        "id": task.id,
        "title": task.title,
        "description": task.description or "",
        "status": task.status or "Todo",
        "priority": task.priority or "Medium",
        "completed": bool(task.completed),
        "progress": int(task.progress or 0),
        "due_date": task.due_date.isoformat() if task.due_date else None,
        "user_id": task.user_id,
        "assigned_to": task.assigned_to,
        "assignee_username": assignee.username if assignee else None,
        "assignee_email": assignee.email if assignee else None,
        "creator_username": creator.username if creator else None,
    }


@app.get("/")
def root():
    return {"message": "TaskForge API is running"}


@app.post("/auth/register")
def register(data: RegisterInput, db: Session = Depends(get_db)):
    email = data.email.lower().strip()
    if db.query(User).filter((User.email == email) | (User.username == data.username)).first():
        raise HTTPException(status_code=409, detail="Username or email is already registered.")
    role = "admin" if email == ADMIN_EMAIL else "member"
    user = User(
        username=data.username.strip(),
        email=email,
        hashed_password=hash_password(data.password),
        role=role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"message": "Account created. You can now log in.", "username": user.username, "email": user.email, "role": user.role}


@app.post("/auth/login")
def login(data: LoginInput, db: Session = Depends(get_db)):
    user = None
    if data.email:
        user = db.query(User).filter(User.email == str(data.email).lower().strip()).first()
    elif data.username:
        user = db.query(User).filter(User.username == data.username.strip()).first()
    if not user or not verify_password(data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect email or password.")
    user.role = "admin" if user.email.lower() == ADMIN_EMAIL else "member"
    db.commit()
    return {
        "access_token": create_access_token(user.id),
        "token_type": "bearer",
        "username": user.username,
        "email": user.email,
        "role": user.role,
    }


@app.get("/me")
def get_me(current_user: User = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "username": current_user.username,
        "email": current_user.email,
        "role": "admin" if current_user.email.lower() == ADMIN_EMAIL else "member",
    }


@app.get("/users")
def list_users(
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    users = db.query(User).order_by(User.username.asc()).all()
    return [{"id": u.id, "username": u.username, "email": u.email, "role": "admin" if u.email.lower() == ADMIN_EMAIL else "member"} for u in users]


@app.get("/tasks")
def list_tasks(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    query = db.query(Task)
    if current_user.email.lower() != ADMIN_EMAIL:
        query = query.filter(Task.assigned_to == current_user.id)
    tasks = query.order_by(Task.id.desc()).all()
    return [task_to_dict(task, db) for task in tasks]


@app.post("/tasks")
def create_task(data: TaskCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    is_admin = current_user.email.lower() == ADMIN_EMAIL
    if not is_admin:
        # Members can create a personal task assigned only to themselves.
        assigned_to = current_user.id
    else:
        assigned_to = data.assigned_to
        if assigned_to is not None and not db.query(User).filter(User.id == assigned_to).first():
            raise HTTPException(status_code=404, detail="Assigned user not found.")
    if data.priority not in {"Low", "Medium", "High", "Urgent"}:
        raise HTTPException(status_code=422, detail="Priority must be Low, Medium, High, or Urgent.")
    task = Task(
        title=data.title.strip(),
        description=data.description,
        status="Todo",
        priority=data.priority,
        completed=False,
        user_id=current_user.id,
        assigned_to=assigned_to,
        due_date=data.due_date,
        progress=0,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return task_to_dict(task, db)


@app.patch("/tasks/{task_id}")
def update_task(task_id: int, data: TaskUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")
    is_admin = current_user.email.lower() == ADMIN_EMAIL
    if not is_admin and task.assigned_to != current_user.id:
        raise HTTPException(status_code=403, detail="You can update only tasks assigned to you.")
    updates = data.model_dump(exclude_unset=True)
    if "status" in updates:
        if updates["status"] not in {"Todo", "In Progress", "Done"}:
            raise HTTPException(status_code=422, detail="Invalid task status.")
        task.status = updates["status"]
        if updates["status"] == "Done":
            task.completed = True
            task.progress = 100
        else:
            task.completed = False
    if "progress" in updates:
        task.progress = updates["progress"]
        if task.progress == 100:
            task.status = "Done"
            task.completed = True
        elif task.status == "Done":
            task.status = "In Progress" if task.progress > 0 else "Todo"
            task.completed = False
        elif task.progress > 0 and task.status == "Todo":
            task.status = "In Progress"
    db.commit()
    db.refresh(task)
    return task_to_dict(task, db)


@app.patch("/admin/tasks/{task_id}")
def admin_update_task(task_id: int, data: TaskAdminUpdate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")
    updates = data.model_dump(exclude_unset=True)
    if "assigned_to" in updates and updates["assigned_to"] is not None:
        if not db.query(User).filter(User.id == updates["assigned_to"]).first():
            raise HTTPException(status_code=404, detail="Assigned user not found.")
    if "priority" in updates and updates["priority"] not in {"Low", "Medium", "High", "Urgent"}:
        raise HTTPException(status_code=422, detail="Invalid priority.")
    if "status" in updates and updates["status"] not in {"Todo", "In Progress", "Done"}:
        raise HTTPException(status_code=422, detail="Invalid status.")
    for key, value in updates.items():
        setattr(task, key, value)
    if task.status == "Done":
        task.completed = True
        task.progress = 100
    else:
        task.completed = False
    if task.progress == 100:
        task.status = "Done"
        task.completed = True
    db.commit()
    db.refresh(task)
    return task_to_dict(task, db)


@app.delete("/tasks/{task_id}")
def delete_task(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")
    if current_user.email.lower() != ADMIN_EMAIL:
        raise HTTPException(status_code=403, detail="Only the admin can delete tasks.")
    db.delete(task)
    db.commit()
    return {"message": "Task deleted."}
