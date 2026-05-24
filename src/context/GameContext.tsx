import React from 'react';
import { useAuth } from './AuthContext';
import { loadStateWithDefaults, saveState } from '../services/persistence';
import { awardXP } from '../lib/gamification';
import {
  applyChallengeCompletion,
  applyMissedDayProtection,
  createStreakState,
  getStreakNotification,
  normalizeStreakState,
  type StreakState,
} from '../lib/streakFreeze';

export interface GameState {
  user: { points: number; name: string };
  ecoVillage: {
    airQuality: number;
    waterQuality: number;
    biodiversity: number;
    trees: number;
    solarPanels: number;
    waterFilters: number;
    pollutionLevel: number;
    wildlife: string[];
    waterStorage: number;
    filterHealth: number;
    lastUpdated: number;
    inventory: string[];
    landscape: { emoji: string; x: number; y: number }[];
  };
  dailyChallenges: {
    id: string;
    title: string;
    description: string;
    points: number;
    progress: number;
    completed: boolean;
  }[];
  gameStats: {
    totalTrashCollected: number;
    perfectCleanups: number;
  };
  streakState: StreakState;
  notifications: string[];
  lastChallengeRefresh: number;
}

export const CHALLENGE_POOL = [
  { title: 'Plant a Tree', description: 'Add a tree to your eco village.', points: 50 },
  { title: 'Collect Ocean Trash', description: 'Play a cleanup round.', points: 40 },
  { title: 'Learn Sustain', description: 'Watch an educational video in the Learn section.', points: 30 },
  { title: 'Solar Upgrade', description: 'Install a solar panel in your village.', points: 60 },
  { title: 'Pure Water', description: 'Install a water filter in your village.', points: 45 },
  { title: 'Eco Post', description: 'Create a post in the community board.', points: 25 },
  { title: 'Quiz Whiz', description: 'Complete a sustainability quiz.', points: 35 },
];

export function generateDailyChallenges(seedTime: number = Date.now()): GameState['dailyChallenges'] {
  const shuffled = [...CHALLENGE_POOL].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, 3).map((c, i) => ({
    id: `c_${seedTime}_${i}`,
    title: c.title,
    description: c.description,
    points: c.points,
    progress: 0,
    completed: false,
  }));
}

interface GameActionBase {
  payload?: unknown;
  activityType?: string;
  metadata?: Record<string, unknown>;
}

interface AddPointsAction extends GameActionBase {
  type: 'ADD_POINTS';
  payload: number;
}

interface CompleteDailyChallengeAction extends GameActionBase {
  type: 'COMPLETE_DAILY_CHALLENGE';
  payload: { points: number; challengeId: string };
}

interface SetStreakStateAction extends GameActionBase {
  type: 'SET_STREAK_STATE';
  payload: StreakState;
}

interface UpdateChallengeAction extends GameActionBase {
  type: 'UPDATE_CHALLENGE';
  payload: { id: string; data: Partial<GameState['dailyChallenges'][number]> };
}

interface UpdateEcoVillageAction extends GameActionBase {
  type: 'UPDATE_ECO_VILLAGE';
  payload: Partial<GameState['ecoVillage']>;
}

interface UpdateOceanStatsAction extends GameActionBase {
  type: 'UPDATE_OCEAN_STATS';
  payload: Partial<GameState['gameStats']>;
}

interface HydrateAction extends GameActionBase {
  type: 'HYDRATE';
  payload: Partial<GameState>;
}

interface AddNotificationAction extends GameActionBase {
  type: 'ADD_NOTIFICATION';
  payload: string;
}

interface ClearNotificationsAction {
  type: 'CLEAR_NOTIFICATIONS';
}

interface SimulateTimeAction {
  type: 'SIMULATE_TIME';
}

interface DefaultAction {
  type: string;
  payload?: unknown;
}

type GameAction =
  | AddPointsAction
  | CompleteDailyChallengeAction
  | SetStreakStateAction
  | UpdateChallengeAction
  | UpdateEcoVillageAction
  | UpdateOceanStatsAction
  | HydrateAction
  | AddNotificationAction
  | ClearNotificationsAction
  | SimulateTimeAction
  | DefaultAction;

const initialState: GameState = {
  user: { points: 0, name: 'Player' },
  ecoVillage: {
    airQuality: 70,
    waterQuality: 72,
    biodiversity: 68,
    trees: 0,
    solarPanels: 0,
    waterFilters: 0,
    pollutionLevel: 30,
    wildlife: [],
    waterStorage: 100,
    filterHealth: 100,
    lastUpdated: Date.now(),
    inventory: [],
    landscape: [],
  },
  dailyChallenges: [
    {
      id: 'c1',
      title: 'Plant a Tree',
      description: 'Add a tree to your eco village.',
      points: 50,
      progress: 0,
      completed: false,
    },
    {
      id: 'c2',
      title: 'Collect Ocean Trash',
      description: 'Play a cleanup round.',
      points: 40,
      progress: 0,
      completed: false,
    },
  ],
  gameStats: {
    totalTrashCollected: 0,
    perfectCleanups: 0,
  },
  streakState: createStreakState(),
  notifications: [],
};

function buildHydratedState(userName: string, loaded?: Partial<GameState> | null): GameState {
  const base = {
    ...initialState,
    user: { ...initialState.user, name: userName },
  };

  if (!loaded) {
    return base;
  }

  return {
    ...base,
    ...loaded,
    user: { ...base.user, ...loaded.user },
    ecoVillage: { ...base.ecoVillage, ...loaded.ecoVillage },
    gameStats: { ...base.gameStats, ...loaded.gameStats },
    dailyChallenges: loaded.dailyChallenges ?? base.dailyChallenges,
    streakState: normalizeStreakState(loaded.streakState ?? base.streakState),
    notifications: loaded.notifications ?? [],
  };
}

type GameContextValue = {
  state: GameState;
  dispatch: React.Dispatch<GameAction>;
};

export const GameContext = React.createContext<GameContextValue | undefined>(undefined);

const RAIN_INTERVAL_MS = 15 * 60 * 1000;
const WATER_PER_RAIN = 20;
const WATER_CONSUMED_PER_TREE_PER_HOUR = 2;
const POLLUTION_PER_ANIMAL_PER_HOUR = 1.5;
const FILTER_DEGRADATION_PER_HOUR = 3;

function simulateTimePassed(state: GameState): { updates: Partial<GameState['ecoVillage']>; events: string[] } {
  const now = Date.now();
  const lastUpdated = state.ecoVillage.lastUpdated || now;
  const elapsed = now - lastUpdated;
  const hoursElapsed = elapsed / (1000 * 60 * 60);

  const events: string[] = [];
  const updates: Partial<GameState['ecoVillage']> = { lastUpdated: now };

  const rainCycles = Math.floor(elapsed / RAIN_INTERVAL_MS);
  if (rainCycles > 0) {
    const waterAdded = rainCycles * WATER_PER_RAIN;
    updates.waterStorage = Math.min(200, (state.ecoVillage.waterStorage || 0) + waterAdded);
    events.push(`🌧️ It rained ${rainCycles} time(s), adding ${waterAdded} water.`);
  }

  const treesCount = state.ecoVillage.trees || 0;
  if (treesCount > 0) {
    const waterConsumed = Math.floor(treesCount * WATER_CONSUMED_PER_TREE_PER_HOUR * hoursElapsed);
    updates.waterStorage = Math.max(0, (updates.waterStorage ?? state.ecoVillage.waterStorage) - waterConsumed);
    if (waterConsumed > 0) events.push(`🌳 ${treesCount} tree(s) consumed ${waterConsumed} water.`);
  }

  const animalCount = state.ecoVillage.wildlife?.length || 0;
  if (animalCount > 0) {
    const pollutionAdded = Math.floor(animalCount * POLLUTION_PER_ANIMAL_PER_HOUR * hoursElapsed);
    updates.waterQuality = Math.max(0, (state.ecoVillage.waterQuality || 0) - pollutionAdded);
    if (pollutionAdded > 0) events.push(`🐾 ${animalCount} animal(s) reduced water quality by ${pollutionAdded}%.`);
  }

  const filterCount = state.ecoVillage.waterFilters || 0;
  if (filterCount > 0) {
    const degradation = Math.floor(FILTER_DEGRADATION_PER_HOUR * hoursElapsed);
    updates.filterHealth = Math.max(0, (state.ecoVillage.filterHealth || 100) - degradation);
    if (degradation > 0) {
      events.push(`🔧 Water filters degraded by ${degradation}%. Health: ${updates.filterHealth}%`);
      if ((updates.filterHealth ?? 0) < 30) {
        events.push(`⚠️ Filters are worn out! Replace them soon.`);
      }
    }
  }

  if ((updates.waterStorage ?? state.ecoVillage.waterStorage) < 20) {
    events.push(`💧 Water storage is critically low!`);
  }

  return { updates, events };
}

function reducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'ADD_POINTS':
      return {
        ...state,
        user: { ...state.user, points: state.user.points + Number(action.payload ?? 0) },
      };
    case 'COMPLETE_DAILY_CHALLENGE':
      return {
        ...state,
        user: { ...state.user, points: state.user.points + Number(action.payload?.points ?? 0) },
      };
    case 'SET_STREAK_STATE':
      return { ...state, streakState: action.payload };
    case 'UPDATE_CHALLENGE':
      return {
        ...state,
        dailyChallenges: state.dailyChallenges.map(c =>
          c.id === action.payload.id ? { ...c, ...action.payload.data } : c
        ),
      };
    case 'REFRESH_CHALLENGES':
      return {
        ...state,
        dailyChallenges: action.payload.challenges,
        lastChallengeRefresh: action.payload.lastChallengeRefresh
      };
    case 'UPDATE_ECO_VILLAGE':
      return {
        ...state,
        ecoVillage: { ...state.ecoVillage, ...action.payload, lastUpdated: Date.now() },
      };
    case 'SIMULATE_TIME': {
      const { updates, events } = simulateTimePassed(state);
      return {
        ...state,
        ecoVillage: { ...state.ecoVillage, ...updates },
        notifications: events,
      };
    }
    case 'ADD_NOTIFICATION':
      return {
        ...state,
        notifications: [action.payload, ...state.notifications].slice(0, 5),
      };
    case 'CLEAR_NOTIFICATIONS':
      return { ...state, notifications: [] };
    case 'UPDATE_OCEAN_STATS':
      return {
        ...state,
        gameStats: {
          ...state.gameStats,
          totalTrashCollected: action.payload.totalTrashCollected ?? state.gameStats.totalTrashCollected,
          perfectCleanups: action.payload.perfectCleanups ?? state.gameStats.perfectCleanups,
        },
      };
    case 'HYDRATE':
      return buildHydratedState(state.user.name, action.payload);
    default:
      return state;
  }
}

export const GameProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [state, dispatchBase] = React.useReducer(reducer, initialState);

  React.useEffect(() => {
    if (!user) return;

    const hydrated = loadStateWithDefaults(user.id, buildHydratedState(user.name, null));
    const protection = applyMissedDayProtection(normalizeStreakState(hydrated.streakState));
    const nextState = buildHydratedState(user.name, {
      ...hydrated,
      streakState: protection.nextState,
    });

    dispatchBase({ type: 'HYDRATE', payload: nextState });

    const notification = getStreakNotification(protection.event);
    if (notification) {
      dispatchBase({ type: 'ADD_NOTIFICATION', payload: notification });
    }

    setTimeout(() => dispatchBase({ type: 'SIMULATE_TIME' }), 100);
  }, [user]);

  const lastRefresh = state.lastChallengeRefresh;
  React.useEffect(() => {
    if (!user || !lastRefresh) return;
    const interval = setInterval(() => {
      const now = Date.now();
      if (now - lastRefresh >= 24 * 60 * 60 * 1000) {
        dispatchBase({
          type: 'REFRESH_CHALLENGES',
          payload: {
            challenges: generateDailyChallenges(now),
            lastChallengeRefresh: now
          }
        });
      }
    }, 15000); // Check every 15 seconds
    return () => clearInterval(interval);
  }, [user, lastRefresh]);

  React.useEffect(() => {
    if (!user) return;
    const t = setTimeout(() => saveState({ userId: user.id, state }), 300);
    return () => clearTimeout(t);
  }, [state, user]);

  React.useEffect(() => {
    if (!user?.id) return;
    awardXP(user.id, 'login_bonus').catch((e) => console.error('[XP] login bonus failed:', e));
  }, [user?.id]);

  const dispatch = React.useCallback((action: GameAction) => {
    if (action.type === 'COMPLETE_DAILY_CHALLENGE') {
      const transition = applyChallengeCompletion(state.streakState);
      dispatchBase({ type: 'COMPLETE_DAILY_CHALLENGE', payload: action.payload });
      dispatchBase({ type: 'SET_STREAK_STATE', payload: transition.nextState });

      const message = getStreakNotification(transition.event);
      if (message) {
        dispatchBase({ type: 'ADD_NOTIFICATION', payload: message });
      }

      if (transition.event !== 'duplicate' && user?.id) {
        awardXP(user.id, 'daily_challenge', { challengeId: action.payload?.challengeId ?? null })
          .then(() => console.log('[XP] Daily challenge processed'))
          .catch((e) => console.error('[XP] Daily challenge failed:', e));
      }
      return;
    }

    dispatchBase(action);

    if (action.type === 'ADD_POINTS') {
      const value = Number(action.payload ?? 0);
      if (!user?.id || value <= 0) {
        return;
      }

      const activity = action.activityType ?? 'daily_challenge';
      console.log('[XP] Awarding XP for', activity, 'user:', user.id);
      awardXP(user.id, activity as never, action.metadata)
        .then((result) => console.log('[XP] Award result:', result))
        .catch((e) => console.error('[XP] Award failed:', e));
    }
  }, [state.streakState, user?.id]);

  return (
    <GameContext.Provider value={{ state, dispatch }}>
      {children}
    </GameContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useGame = () => {
  const ctx = React.useContext(GameContext);
  if (!ctx) throw new Error('useGame must be used within GameProvider');
  return ctx;
};
