import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync, spawn } from 'child_process';
import { logError } from './utils.js';

// Orchestration paths
const ORCHESTRATOR_DIR = path.join(os.homedir(), '.claude', 'orchestrator');
const SESSIONS_DIR = path.join(ORCHESTRATOR_DIR, 'sessions');
const WORKFLOWS_DIR = path.join(ORCHESTRATOR_DIR, 'workflows');
const TEMPLATES_DIR = path.join(ORCHESTRATOR_DIR, 'templates');
const TASKS_DIR = path.join(ORCHESTRATOR_DIR, 'tasks');
const HOOKS_DIR = path.join(ORCHESTRATOR_DIR, 'hooks');
const ANALYTICS_PATH = path.join(ORCHESTRATOR_DIR, 'analytics.json');

// Ensure orchestrator directories exist
export const ensureOrchestrator = () => {
  [ORCHESTRATOR_DIR, SESSIONS_DIR, WORKFLOWS_DIR, TEMPLATES_DIR, TASKS_DIR, HOOKS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  // Initialize analytics file
  if (!fs.existsSync(ANALYTICS_PATH)) {
    fs.writeFileSync(ANALYTICS_PATH, JSON.stringify({
      sessions: [],
      workflows: [],
      tasks: [],
      totalTokens: 0,
      totalCost: 0,
    }, null, 2));
  }
};

// ============= SESSION MANAGEMENT =============

export class SessionManager {
  constructor() {
    ensureOrchestrator();
  }

  // Create new session
  createSession(profileName, projectPath, metadata = {}) {
    const sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const session = {
      id: sessionId,
      profile: profileName,
      projectPath: projectPath || process.cwd(),
      status: 'active',
      startTime: new Date().toISOString(),
      endTime: null,
      pid: null,
      metadata,
      logs: [],
    };

    const sessionPath = path.join(SESSIONS_DIR, `${sessionId}.json`);
    fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2));
    return session;
  }

  // List all sessions
  listSessions(filter = {}) {
    const files = fs.readdirSync(SESSIONS_DIR);
    const sessions = files
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          return JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf8'));
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    // Apply filters
    let filtered = sessions;
    if (filter.status) {
      filtered = filtered.filter(s => s.status === filter.status);
    }
    if (filter.profile) {
      filtered = filtered.filter(s => s.profile === filter.profile);
    }

    return filtered.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
  }

  // Get session by ID
  getSession(sessionId) {
    const sessionPath = path.join(SESSIONS_DIR, `${sessionId}.json`);
    if (fs.existsSync(sessionPath)) {
      return JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
    }
    return null;
  }

  // Update session
  updateSession(sessionId, updates) {
    const session = this.getSession(sessionId);
    if (!session) return null;

    const updated = { ...session, ...updates };
    const sessionPath = path.join(SESSIONS_DIR, `${sessionId}.json`);
    fs.writeFileSync(sessionPath, JSON.stringify(updated, null, 2));
    return updated;
  }

  // End session
  endSession(sessionId) {
    return this.updateSession(sessionId, {
      status: 'completed',
      endTime: new Date().toISOString(),
    });
  }

  // Kill session
  killSession(sessionId) {
    const session = this.getSession(sessionId);
    if (session && session.pid) {
      try {
        process.kill(session.pid, 'SIGTERM');
      } catch (error) {
        logError('killSession', error);
      }
    }
    return this.updateSession(sessionId, {
      status: 'killed',
      endTime: new Date().toISOString(),
    });
  }

  // Clean old sessions
  cleanSessions(daysOld = 7) {
    const cutoff = Date.now() - (daysOld * 24 * 60 * 60 * 1000);
    const sessions = this.listSessions();
    let cleaned = 0;

    sessions.forEach(session => {
      const sessionTime = new Date(session.startTime).getTime();
      if (sessionTime < cutoff && session.status !== 'active') {
        const sessionPath = path.join(SESSIONS_DIR, `${session.id}.json`);
        fs.unlinkSync(sessionPath);
        cleaned++;
      }
    });

    return cleaned;
  }
}

// ============= WORKFLOW ENGINE =============

export class WorkflowEngine {
  constructor() {
    ensureOrchestrator();
  }

  // Create workflow
  createWorkflow(name, steps, metadata = {}) {
    const workflowId = `workflow-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const workflow = {
      id: workflowId,
      name,
      steps, // Array of { command, profile, condition }
      metadata,
      created: new Date().toISOString(),
    };

    const workflowPath = path.join(WORKFLOWS_DIR, `${workflowId}.json`);
    fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));
    return workflow;
  }

  // List workflows
  listWorkflows() {
    const files = fs.readdirSync(WORKFLOWS_DIR);
    return files
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          return JSON.parse(fs.readFileSync(path.join(WORKFLOWS_DIR, f), 'utf8'));
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.created) - new Date(a.created));
  }

  // Get workflow
  getWorkflow(workflowId) {
    const workflowPath = path.join(WORKFLOWS_DIR, `${workflowId}.json`);
    if (fs.existsSync(workflowPath)) {
      return JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
    }
    return null;
  }

  // Execute workflow
  async executeWorkflow(workflowId, context = {}) {
    const workflow = this.getWorkflow(workflowId);
    if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);

    const execution = {
      workflowId,
      startTime: new Date().toISOString(),
      steps: [],
      status: 'running',
      context,
    };

    for (const [index, step] of workflow.steps.entries()) {
      // Check condition
      if (step.condition && !this.evaluateCondition(step.condition, context)) {
        execution.steps.push({
          index,
          skipped: true,
          reason: 'condition not met',
        });
        continue;
      }

      // Execute step
      try {
        const result = await this.executeStep(step, context);
        execution.steps.push({
          index,
          success: true,
          result,
        });

        // Update context with result
        context[`step${index}_result`] = result;
      } catch (error) {
        execution.steps.push({
          index,
          success: false,
          error: error.message,
        });

        if (step.continueOnError !== true) {
          execution.status = 'failed';
          break;
        }
      }
    }

    if (execution.status === 'running') {
      execution.status = 'completed';
    }

    execution.endTime = new Date().toISOString();
    return execution;
  }

  // Execute single step
  async executeStep(step, context) {
    // Replace variables in command
    let command = step.command;
    Object.entries(context).forEach(([key, value]) => {
      command = command.replace(`{{${key}}}`, value);
    });

    return new Promise((resolve, reject) => {
      const child = spawn(command, [], { shell: true, stdio: 'pipe' });
      let output = '';
      let errorOutput = '';

      child.stdout.on('data', data => {
        output += data.toString();
      });

      child.stderr.on('data', data => {
        errorOutput += data.toString();
      });

      child.on('close', code => {
        if (code === 0) {
          resolve({ output, exitCode: code });
        } else {
          reject(new Error(`Command failed with code ${code}: ${errorOutput}`));
        }
      });

      if (step.timeout) {
        setTimeout(() => {
          child.kill();
          reject(new Error('Step timeout'));
        }, step.timeout);
      }
    });
  }

  // Evaluate condition
  evaluateCondition(condition, context) {
    // Simple condition evaluation (can be extended)
    try {
      // Replace variables
      let expr = condition;
      Object.entries(context).forEach(([key, value]) => {
        expr = expr.replace(`{{${key}}}`, JSON.stringify(value));
      });

      // Evaluate (basic implementation)
      return new Function(`return ${expr}`)();
    } catch {
      return false;
    }
  }

  // Delete workflow
  deleteWorkflow(workflowId) {
    const workflowPath = path.join(WORKFLOWS_DIR, `${workflowId}.json`);
    if (fs.existsSync(workflowPath)) {
      fs.unlinkSync(workflowPath);
      return true;
    }
    return false;
  }
}

// ============= PROJECT TEMPLATES =============

export class TemplateManager {
  constructor() {
    ensureOrchestrator();
    this.initializeDefaultTemplates();
  }

  // Initialize default templates
  initializeDefaultTemplates() {
    const defaultTemplates = [
      {
        name: 'web-app',
        description: 'Full-stack web application with React',
        files: {
          '.claude-profile': 'default',
          'README.md': '# {{projectName}}\n\nA web application built with Claude',
          'package.json': JSON.stringify({
            name: '{{projectName}}',
            version: '1.0.0',
            scripts: {
              dev: 'vite',
              build: 'vite build',
            },
          }, null, 2),
        },
        profile: 'default',
        mcpServers: ['web-search', 'github'],
        skills: ['web-development'],
      },
      {
        name: 'python-api',
        description: 'Python API with FastAPI',
        files: {
          '.claude-profile': 'default',
          'README.md': '# {{projectName}}\n\nA Python API built with FastAPI',
          'requirements.txt': 'fastapi\nuvicorn\npydantic',
          'main.py': 'from fastapi import FastAPI\n\napp = FastAPI()\n\n@app.get("/")\ndef read_root():\n    return {"Hello": "World"}',
        },
        profile: 'default',
        mcpServers: ['python-docs'],
        skills: ['python-development'],
      },
      {
        name: 'data-analysis',
        description: 'Data analysis project with Jupyter',
        files: {
          '.claude-profile': 'default',
          'README.md': '# {{projectName}}\n\nData analysis project',
          'requirements.txt': 'pandas\nnumpy\nmatplotlib\njupyter',
          'analysis.ipynb': '{\n "cells": [],\n "metadata": {},\n "nbformat": 4,\n "nbformat_minor": 2\n}',
        },
        profile: 'default',
        mcpServers: ['data-tools'],
        skills: ['data-analysis'],
      },
    ];

    defaultTemplates.forEach(template => {
      const templatePath = path.join(TEMPLATES_DIR, `${template.name}.json`);
      if (!fs.existsSync(templatePath)) {
        fs.writeFileSync(templatePath, JSON.stringify(template, null, 2));
      }
    });
  }

  // List templates
  listTemplates() {
    const files = fs.readdirSync(TEMPLATES_DIR);
    return files
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          return JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, f), 'utf8'));
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  // Get template
  getTemplate(name) {
    const templatePath = path.join(TEMPLATES_DIR, `${name}.json`);
    if (fs.existsSync(templatePath)) {
      return JSON.parse(fs.readFileSync(templatePath, 'utf8'));
    }
    return null;
  }

  // Create project from template
  createProject(templateName, projectName, targetDir) {
    const template = this.getTemplate(templateName);
    if (!template) throw new Error(`Template not found: ${templateName}`);

    const projectPath = path.join(targetDir, projectName);

    // Create project directory
    if (fs.existsSync(projectPath)) {
      throw new Error(`Project directory already exists: ${projectPath}`);
    }
    fs.mkdirSync(projectPath, { recursive: true });

    // Create files from template
    Object.entries(template.files).forEach(([filename, content]) => {
      const filePath = path.join(projectPath, filename);
      const processedContent = content.replace(/{{projectName}}/g, projectName);

      // Create subdirectories if needed
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(filePath, processedContent);
    });

    return {
      projectPath,
      template: templateName,
      created: new Date().toISOString(),
    };
  }

  // Add custom template
  addTemplate(template) {
    const templatePath = path.join(TEMPLATES_DIR, `${template.name}.json`);
    fs.writeFileSync(templatePath, JSON.stringify(template, null, 2));
    return template;
  }

  // Delete template
  deleteTemplate(name) {
    const templatePath = path.join(TEMPLATES_DIR, `${name}.json`);
    if (fs.existsSync(templatePath)) {
      fs.unlinkSync(templatePath);
      return true;
    }
    return false;
  }
}

// ============= TASK QUEUE =============

export class TaskQueue {
  constructor() {
    ensureOrchestrator();
    this.running = new Map();
  }

  // Add task to queue
  addTask(task) {
    const taskId = `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const taskData = {
      id: taskId,
      ...task,
      status: 'queued',
      created: new Date().toISOString(),
      started: null,
      completed: null,
      result: null,
      error: null,
    };

    const taskPath = path.join(TASKS_DIR, `${taskId}.json`);
    fs.writeFileSync(taskPath, JSON.stringify(taskData, null, 2));
    return taskData;
  }

  // List tasks
  listTasks(filter = {}) {
    const files = fs.readdirSync(TASKS_DIR);
    const tasks = files
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          return JSON.parse(fs.readFileSync(path.join(TASKS_DIR, f), 'utf8'));
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    let filtered = tasks;
    if (filter.status) {
      filtered = filtered.filter(t => t.status === filter.status);
    }

    return filtered.sort((a, b) => new Date(b.created) - new Date(a.created));
  }

  // Get task
  getTask(taskId) {
    const taskPath = path.join(TASKS_DIR, `${taskId}.json`);
    if (fs.existsSync(taskPath)) {
      return JSON.parse(fs.readFileSync(taskPath, 'utf8'));
    }
    return null;
  }

  // Update task
  updateTask(taskId, updates) {
    const task = this.getTask(taskId);
    if (!task) return null;

    const updated = { ...task, ...updates };
    const taskPath = path.join(TASKS_DIR, `${taskId}.json`);
    fs.writeFileSync(taskPath, JSON.stringify(updated, null, 2));
    return updated;
  }

  // Execute task
  async executeTask(taskId) {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    this.updateTask(taskId, {
      status: 'running',
      started: new Date().toISOString(),
    });

    try {
      const result = await this.runTaskCommand(task);
      this.updateTask(taskId, {
        status: 'completed',
        completed: new Date().toISOString(),
        result,
      });
      return result;
    } catch (error) {
      this.updateTask(taskId, {
        status: 'failed',
        completed: new Date().toISOString(),
        error: error.message,
      });
      throw error;
    }
  }

  // Run task command
  async runTaskCommand(task) {
    return new Promise((resolve, reject) => {
      const child = spawn(task.command, task.args || [], {
        cwd: task.cwd || process.cwd(),
        shell: true,
        stdio: 'pipe',
      });

      let output = '';
      let errorOutput = '';

      child.stdout.on('data', data => {
        output += data.toString();
      });

      child.stderr.on('data', data => {
        errorOutput += data.toString();
      });

      child.on('close', code => {
        if (code === 0) {
          resolve({ output, exitCode: code });
        } else {
          reject(new Error(`Task failed with code ${code}: ${errorOutput}`));
        }
      });
    });
  }

  // Process queue (run pending tasks)
  async processQueue(concurrency = 1) {
    const pending = this.listTasks({ status: 'queued' });
    const running = [];

    for (const task of pending.slice(0, concurrency)) {
      running.push(this.executeTask(task.id));
    }

    return Promise.allSettled(running);
  }
}

// ============= HOOKS SYSTEM =============

export class HooksManager {
  constructor() {
    ensureOrchestrator();
  }

  // Register hook
  registerHook(event, script) {
    const hookPath = path.join(HOOKS_DIR, `${event}.sh`);
    fs.writeFileSync(hookPath, script);
    fs.chmodSync(hookPath, '755');
    return true;
  }

  // List hooks
  listHooks() {
    const files = fs.readdirSync(HOOKS_DIR);
    return files.filter(f => f.endsWith('.sh')).map(f => f.replace('.sh', ''));
  }

  // Execute hook
  executeHook(event, context = {}) {
    const hookPath = path.join(HOOKS_DIR, `${event}.sh`);
    if (!fs.existsSync(hookPath)) return null;

    try {
      // Set environment variables from context
      const env = { ...process.env, ...context };
      const result = execSync(`bash "${hookPath}"`, { env, encoding: 'utf8' });
      return { success: true, output: result };
    } catch (error) {
      logError(`hook-${event}`, error);
      return { success: false, error: error.message };
    }
  }

  // Delete hook
  deleteHook(event) {
    const hookPath = path.join(HOOKS_DIR, `${event}.sh`);
    if (fs.existsSync(hookPath)) {
      fs.unlinkSync(hookPath);
      return true;
    }
    return false;
  }
}

// ============= ANALYTICS =============

export class Analytics {
  constructor() {
    ensureOrchestrator();
  }

  // Track session
  trackSession(session) {
    const analytics = this.load();
    analytics.sessions.push({
      id: session.id,
      profile: session.profile,
      startTime: session.startTime,
      endTime: session.endTime,
      duration: session.endTime ?
        new Date(session.endTime) - new Date(session.startTime) : null,
    });
    this.save(analytics);
  }

  // Track workflow
  trackWorkflow(execution) {
    const analytics = this.load();
    analytics.workflows.push({
      workflowId: execution.workflowId,
      startTime: execution.startTime,
      endTime: execution.endTime,
      status: execution.status,
      stepsCompleted: execution.steps.filter(s => s.success).length,
    });
    this.save(analytics);
  }

  // Get statistics
  getStats() {
    const analytics = this.load();
    const sessions = new SessionManager().listSessions();
    const workflows = new WorkflowEngine().listWorkflows();
    const tasks = new TaskQueue().listTasks();

    return {
      sessions: {
        total: sessions.length,
        active: sessions.filter(s => s.status === 'active').length,
        completed: sessions.filter(s => s.status === 'completed').length,
      },
      workflows: {
        total: workflows.length,
        executed: analytics.workflows.length,
      },
      tasks: {
        total: tasks.length,
        queued: tasks.filter(t => t.status === 'queued').length,
        running: tasks.filter(t => t.status === 'running').length,
        completed: tasks.filter(t => t.status === 'completed').length,
        failed: tasks.filter(t => t.status === 'failed').length,
      },
    };
  }

  // Load analytics
  load() {
    if (fs.existsSync(ANALYTICS_PATH)) {
      return JSON.parse(fs.readFileSync(ANALYTICS_PATH, 'utf8'));
    }
    return {
      sessions: [],
      workflows: [],
      tasks: [],
      totalTokens: 0,
      totalCost: 0,
    };
  }

  // Save analytics
  save(analytics) {
    fs.writeFileSync(ANALYTICS_PATH, JSON.stringify(analytics, null, 2));
  }

  // Reset analytics
  reset() {
    fs.writeFileSync(ANALYTICS_PATH, JSON.stringify({
      sessions: [],
      workflows: [],
      tasks: [],
      totalTokens: 0,
      totalCost: 0,
    }, null, 2));
  }
}

// Export instances
export const sessionManager = new SessionManager();
export const workflowEngine = new WorkflowEngine();
export const templateManager = new TemplateManager();
export const taskQueue = new TaskQueue();
export const hooksManager = new HooksManager();
export const analytics = new Analytics();
