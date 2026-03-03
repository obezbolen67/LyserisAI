import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';
import api from './api';

export interface ScheduledTask {
  id: string;
  title: string;
  description: string;
  scheduledTime: number;
  createdAt: number;
  status: 'scheduled' | 'completed' | 'cancelled';
  notificationId: number;
}

const STORAGE_KEY = 'fexo_scheduled_tasks';

// --- Helper: Base64 Converter ---
function urlBase64ToUint8Array(base64String: string) {
  try {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
      .replace(/-/g, '+')
      .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  } catch (e) {
    console.error('[VAPID] Failed to convert VAPID key:', e);
    throw new Error("Invalid VAPID Key format");
  }
}

// --- Persistence ---
export const getTasks = (): ScheduledTask[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (e) { return []; }
};

const saveTasks = (tasks: ScheduledTask[]) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  window.dispatchEvent(new Event('fexo-tasks-updated'));
};

export const addTask = (task: ScheduledTask) => {
  const tasks = getTasks();
  tasks.push(task);
  saveTasks(tasks);
};

export const updateTaskStatus = (id: string, status: ScheduledTask['status']) => {
  const tasks = getTasks();
  const index = tasks.findIndex(t => t.id === id);
  if (index !== -1) {
    tasks[index].status = status;
    saveTasks(tasks);
  }
};

export const deleteTask = async (id: string) => {
  const tasks = getTasks();
  const taskToDelete = tasks.find(t => t.id === id);
  if (taskToDelete && taskToDelete.status === 'scheduled') {
    try {
      if (Capacitor.isNativePlatform()) {
        await LocalNotifications.cancel({ notifications: [{ id: taskToDelete.notificationId }] });
      }
    } catch (e) { }
  }
  const newTasks = tasks.filter(t => t.id !== id);
  saveTasks(newTasks);
};

export const requestNotificationPermission = async (): Promise<boolean> => {
  try {
    if (Capacitor.isNativePlatform()) {
      const result = await LocalNotifications.requestPermissions();
      return result.display === 'granted';
    } else {
      if (!('Notification' in window)) return false;
      const permission = await Notification.requestPermission();
      return permission === 'granted';
    }
  } catch (e) {
    console.error('Error requesting permissions:', e);
    return false;
  }
};

// --- Server Push Setup ---
const trySetupServerPush = async (title: string, body: string, timestamp: string, taskId: string) => {
  // This group will collapse and hide in production
  console.groupCollapsed('[SCHEDULER] Push Setup');
  
  let vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (!vapidKey) {
    console.error('❌ Missing VITE_VAPID_PUBLIC_KEY');
    console.groupEnd();
    return;
  }
  vapidKey = vapidKey.trim();

  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.debug('⚠️ Push Messaging not supported');
    console.groupEnd();
    return;
  }

  try {
    console.debug('Getting SW Registration...');
    let registration = await navigator.serviceWorker.getRegistration();
    
    if (!registration || !registration.active) {
        console.debug('SW not active, registering...');
        await navigator.serviceWorker.register('/sw.js');
        registration = await navigator.serviceWorker.ready;
    }

    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      console.debug('Creating new subscription...');
      const convertedKey = urlBase64ToUint8Array(vapidKey);
      
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedKey
      });
    }

    console.debug('Sending to backend...');
    const subResponse = await api('/push/subscribe', {
      method: 'POST',
      body: JSON.stringify(subscription)
    });
    
    if(!subResponse.ok) throw new Error(`Backend returned ${subResponse.status}`);

    await api('/push/schedule', {
      method: 'POST',
      body: JSON.stringify({ title, body, timestamp, taskId })
    });

    console.debug('🎉 Push Scheduled');
  } catch (error: any) {
    // Keep errors visible for debugging locally, usually hidden/handled in prod
    console.error('❌ PUSH SETUP FAILED:', error.message || error);
  } finally {
    console.groupEnd();
  }
};

export const scheduleClientNotification = async (
  title: string,
  description: string | undefined,
  scheduleDate: Date
): Promise<{ success: boolean; error?: string }> => {
  try {
    const now = new Date();
    if (scheduleDate.getTime() <= now.getTime()) {
      return { success: false, error: 'Scheduled time must be in the future' };
    }

    const bodyContent = description || `Your task "${title}" starts now.`;
    const notificationId = Math.floor(Math.random() * 1000000);
    const taskId = crypto.randomUUID();

    // Mobile (Native)
    if (Capacitor.isNativePlatform()) {
      const perm = await LocalNotifications.checkPermissions();
      if (perm.display !== 'granted') {
        const request = await LocalNotifications.requestPermissions();
        if (request.display !== 'granted') {
             return { success: false, error: 'Notification permission missing on device.' };
        }
      }
      
      await LocalNotifications.schedule({
        notifications: [{
          title,
          body: bodyContent,
          id: notificationId,
          schedule: { at: scheduleDate },
          sound: undefined,
          smallIcon: 'ic_stat_icon_config_sample',
        }],
      });
    } 
    // Web (PWA)
    else {
      if (!('Notification' in window)) {
        return { success: false, error: 'Notifications not supported.' };
      }

      if (Notification.permission !== 'granted') {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            return { success: false, error: 'Permission needed. Enable notifications in browser settings.' };
        }
      }

      // 1. Background Push
      trySetupServerPush(title, bodyContent, scheduleDate.toISOString(), taskId);

      // 2. Foreground Fallback
      const delay = scheduleDate.getTime() - Date.now();
      if (delay > 0 && delay < 2147483647) {
        setTimeout(() => {
          const currentTasks = getTasks();
          const task = currentTasks.find(t => t.id === taskId);
          if (task && task.status !== 'completed') {
            new Notification(title, { 
              body: bodyContent, 
              icon: '/lyseris.svg',
              tag: taskId 
            });
            updateTaskStatus(taskId, 'completed');
            try { new Audio('/notification.mp3').play().catch(() => {}); } catch(e){}
          }
        }, delay);
      }
    }

    addTask({
      id: taskId,
      title,
      description: bodyContent,
      scheduledTime: scheduleDate.getTime(),
      createdAt: Date.now(),
      status: 'scheduled',
      notificationId
    });

    return { success: true };
  } catch (err: any) {
    console.error("[SCHEDULER] Fatal Error:", err);
    return { success: false, error: err.message || 'Unknown scheduling error' };
  }
};
