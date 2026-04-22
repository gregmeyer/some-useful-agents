/**
 * Home page layout JS: thin wrapper around the shared widget layout
 * with home-specific element IDs, storage keys, and default containers.
 */
import { widgetLayoutJS } from './widget-layout.js.js';

export const HOME_LAYOUT_JS = widgetLayoutJS({
  prefix: 'home',
  storageKey: 'sua-home-layout',
  hostId: 'home-containers',
  dataId: 'home-widget-data',
  editToggleId: 'home-edit-toggle',
  addContainerId: 'home-add-container',
  protectedPrefixes: ['_home-'],
  defaultContainers: function (allIds: string[], _systemIds: string[]) {
    // Split system widgets into logical groups.
    var overviewSet = ['_home-runs-today', '_home-failure-rate', '_home-agents', '_home-scheduled'];
    var activitySet = ['_home-in-flight', '_home-recent-activity'];
    var actionsSet = ['_home-quick-actions'];
    var overview = allIds.filter(function (id) { return overviewSet.indexOf(id) !== -1; });
    var activity = allIds.filter(function (id) { return activitySet.indexOf(id) !== -1; });
    var actions = allIds.filter(function (id) { return actionsSet.indexOf(id) !== -1; });
    var rest = allIds.filter(function (id) {
      return overview.indexOf(id) === -1 && activity.indexOf(id) === -1 && actions.indexOf(id) === -1;
    });
    var containers: Array<{ id: string; label: string; tiles: string[] }> = [
      { id: 'overview', label: 'Overview', tiles: overview },
      { id: 'activity', label: 'Activity', tiles: activity },
      { id: 'actions', label: 'Quick Actions', tiles: actions },
    ];
    if (rest.length > 0) {
      containers.push({ id: '_other', label: 'Other', tiles: rest });
    }
    return containers;
  },
});
