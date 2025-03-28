$(document).ready(async () => {
  try {
    showLoading(true);
    
    // Initialize WebSocket connection
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${wsProtocol}//${window.location.host}`);
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'new_visit') {
        showNewVisitorNotification(data.data.ip);
      }
    };
    
    // Load initial data
    await loadData();
    await loadPerformanceMetrics();
    
    // Setup event listeners
    setupDateFilters();
    setupDataExport();
    setupVisitorModals();
    
    // Update last updated time
    $('#lastUpdated').text(new Date().toLocaleString());
    
  } catch (error) {
    console.error('Admin initialization error:', error);
    showError(error.message);
  } finally {
    showLoading(false);
  }
});

async function loadData() {
  const dateFilter = $('#dateFilter').val();
  const [statsResponse, visitorsResponse] = await Promise.all([
    fetch('/admin/api/stats'),
    fetch(`/admin/api/visitors?range=${dateFilter}`)
  ]);

  if (!statsResponse.ok || !visitorsResponse.ok) {
    throw new Error('Failed to fetch data from server');
  }

  const [stats, visitorsData] = await Promise.all([
    statsResponse.json(),
    visitorsResponse.json()
  ]);

  updateStatsUI(stats);
  renderCharts(visitorsData.visitors);
  renderVisitorList(visitorsData.visitors);
}

function updateStatsUI(stats) {
  $('#totalVisits').text(stats.totalVisits.toLocaleString());
  $('#uniqueVisitors').text(stats.uniqueVisitors.toLocaleString());
  $('#trackingStatus').text(stats.totalVisits > 0 ? 'Active' : 'Inactive');
}

function renderCharts(visitors) {
  renderDeviceChart(processDeviceData(visitors));
  renderLocationChart(processLocationData(visitors));
  renderPathChart(processPathData(visitors));
}

function processDeviceData(visitors) {
  const deviceCounts = {};
  
  visitors.forEach(visitor => {
    visitor.visits.forEach(visit => {
      const device = visit.device || 'Unknown';
      deviceCounts[device] = (deviceCounts[device] || 0) + 1;
    });
  });

  // Sort and limit to top 5 devices
  return Object.entries(deviceCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .reduce((acc, [label, value]) => {
      acc.labels.push(label);
      acc.values.push(value);
      return acc;
    }, { labels: [], values: [] });
}

function processLocationData(visitors) {
  const locationCounts = {};
  
  visitors.forEach(visitor => {
    const visit = visitor.visits[0];
    if (visit.geo) {
      const location = visit.geo.city ? 
        `${visit.geo.city}, ${visit.geo.country}` : 
        visit.geo.country || 'Unknown';
      locationCounts[location] = (locationCounts[location] || 0) + 1;
    }
  });

  // Sort and limit to top 10 locations
  return Object.entries(locationCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .reduce((acc, [label, value]) => {
      acc.labels.push(label);
      acc.values.push(value);
      return acc;
    }, { labels: [], values: [] });
}

function processPathData(visitors) {
  const pathCounts = {};
  
  visitors.forEach(visitor => {
    visitor.visits.forEach(visit => {
      const path = visit.path || '/';
      pathCounts[path] = (pathCounts[path] || 0) + 1;
    });
  });
  
  return Object.entries(pathCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .reduce((acc, [label, value]) => {
      acc.labels.push(label);
      acc.values.push(value);
      return acc;
    }, { labels: [], values: [] });
}

function renderDeviceChart({ labels, values }) {
  const ctx = $('#deviceChart')[0].getContext('2d');
  
  // Destroy previous chart if it exists
  if (window.deviceChart) {
    window.deviceChart.destroy();
  }
  
  window.deviceChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: values,
        backgroundColor: [
          '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6'
        ],
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right'
        }
      }
    }
  });
}

function renderLocationChart({ labels, values }) {
  const ctx = $('#locationChart')[0].getContext('2d');
  
  if (window.locationChart) {
    window.locationChart.destroy();
  }
  
  window.locationChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Visitors',
        data: values,
        backgroundColor: '#3B82F6',
        borderColor: '#2563EB',
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            precision: 0
          }
        }
      },
      plugins: {
        legend: {
          display: false
        }
      }
    }
  });
}

function renderPathChart({ labels, values }) {
  const ctx = $('#pathChart')[0].getContext('2d');
  
  if (window.pathChart) {
    window.pathChart.destroy();
  }
  
  window.pathChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Page Visits',
        data: values,
        backgroundColor: '#3B82F6',
        borderColor: '#2563EB',
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true
        }
      }
    }
  });
}

function renderVisitorList(visitors) {
  const container = $('#visitorsList');
  container.empty();

  if (visitors.length === 0) {
    container.html(`
      <div class="p-4 text-center text-gray-500">
        No visitor data available
      </div>
    `);
    return;
  }

  visitors.slice(0, 10).forEach(visitor => {
    const lastVisit = visitor.visits[visitor.visits.length - 1];
    const card = $(`
      <div class="visitor-card p-4 hover:bg-gray-50" data-ip="${visitor.ip}">
        <div class="flex justify-between items-start mb-2">
          <div>
            <p class="font-bold text-blue-600">${visitor.ip}</p>
            <p class="text-sm text-gray-600">${lastVisit.device || 'Unknown device'}</p>
          </div>
          <span class="text-xs text-gray-500">
            ${new Date(lastVisit.timestamp).toLocaleString()}
          </span>
        </div>
        <div class="grid grid-cols-2 gap-2 text-sm">
          <div>
            <span class="font-medium">Browser:</span> ${lastVisit.browser}
          </div>
          <div>
            <span class="font-medium">OS:</span> ${lastVisit.os}
          </div>
          <div class="col-span-2">
            <span class="font-medium">Location:</span> 
            ${lastVisit.geo ? `${lastVisit.geo.city || ''}${lastVisit.geo.city && lastVisit.geo.country ? ', ' : ''}${lastVisit.geo.country || ''}` : 'Unknown'}
          </div>
        </div>
      </div>
    `);
    
    container.append(card);
  });
}

async function loadPerformanceMetrics() {
  try {
    const response = await fetch('/admin/api/performance');
    const metrics = await response.json();
    
    $('#avgLoadTime').text(`${metrics.avgLoadTime.toFixed(2)}ms`);
    $('#memoryUsage').text(`${(metrics.memoryUsage / 1024 / 1024).toFixed(2)} MB`);
    $('#uptime').text(formatUptime(metrics.uptime));
    $('#cpuUsage').text(metrics.cpuUsage.toFixed(2));
  } catch (error) {
    console.error('Failed to load performance metrics:', error);
  }
}

function formatUptime(seconds) {
  const days = Math.floor(seconds / (3600 * 24));
  const hours = Math.floor((seconds % (3600 * 24)) / 3600);
  return `${days}d ${hours}h`;
}

function setupDateFilters() {
  $('#dateFilter').on('change', async function() {
    try {
      showLoading(true);
      await loadData();
      $('#lastUpdated').text(new Date().toLocaleString());
    } catch (error) {
      showError(error.message);
    } finally {
      showLoading(false);
    }
  });
}

function setupDataExport() {
  $('#exportBtn').on('click', async function() {
    try {
      showLoading(true);
      const $btn = $(this);
      
      // Disable button during export
      $btn.prop('disabled', true).text('Exporting...');
      
      // Fetch the CSV data
      const response = await fetch('/admin/api/export');
      
      if (!response.ok) {
        throw new Error('Failed to export data');
      }
      
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      
      // Create a temporary anchor element to trigger download
      const $a = $('<a>', {
        href: url,
        download: `visitors-${new Date().toISOString().split('T')[0]}.csv`,
        style: 'display: none;'
      }).appendTo('body');
      
      // Trigger click and then remove
      $a[0].click();
      setTimeout(() => {
        $a.remove();
        URL.revokeObjectURL(url);
      }, 100);
      
      showNotification('Data exported successfully', 'success');
    } catch (error) {
      showError('Failed to export data: ' + error.message);
    } finally {
      showLoading(false);
      $('#exportBtn').prop('disabled', false).text('Export Data');
    }
  });
}

function setupVisitorModals() {
  $(document).on('click', '.visitor-card', function() {
    const ip = $(this).data('ip');
    showVisitorDetails(ip);
  });
  
  $('#closeModal').on('click', function() {
    $('#visitorModal').hide();
  });
}

async function showVisitorDetails(ip) {
  try {
    showLoading(true);
    const response = await fetch(`/admin/api/visitors/${encodeURIComponent(ip)}`);
    const visitor = await response.json();
    
    $('#modalTitle').text(`Visitor Details: ${visitor.ip}`);
    
    const detailsHtml = visitor.visits.map(visit => `
      <div class="border-b pb-4 mb-4">
        <p class="font-semibold">${new Date(visit.timestamp).toLocaleString()}</p>
        <div class="grid grid-cols-2 gap-4 mt-2">
          <div><span class="font-medium">Device:</span> ${visit.device}</div>
          <div><span class="font-medium">Browser:</span> ${visit.browser}</div>
          <div><span class="font-medium">OS:</span> ${visit.os}</div>
          <div><span class="font-medium">Location:</span> ${visit.geo?.city || ''} ${visit.geo?.country || 'Unknown'}</div>
          <div class="col-span-2">
            <span class="font-medium">Page:</span> ${visit.path}
          </div>
          <div class="col-span-2">
            <span class="font-medium">Referrer:</span> ${visit.referrer}
          </div>
        </div>
      </div>
    `).join('');
    
    $('#visitorDetails').html(detailsHtml);
    $('#visitorModal').show();
  } catch (error) {
    showError('Failed to load visitor details: ' + error.message);
  } finally {
    showLoading(false);
  }
}

function showNewVisitorNotification(ip) {
  const $badge = $('#newVisitorBadge');
  $badge.removeClass('hidden').text(`New visitor: ${ip}`);
  
  setTimeout(() => {
    $badge.addClass('hidden');
  }, 5000);
}

function showNotification(message, type = 'info') {
  const $notification = $('#notification');
  const $content = $('#notificationContent');
  
  $content.text(message);
  $content.removeClass('bg-red-500 bg-green-500 bg-blue-500');
  
  if (type === 'error') {
    $content.addClass('bg-red-500 text-white');
  } else if (type === 'success') {
    $content.addClass('bg-green-500 text-white');
  } else {
    $content.addClass('bg-blue-500 text-white');
  }
  
  $notification.removeClass('hidden');
  
  setTimeout(() => {
    $notification.addClass('hidden');
  }, 5000);
}

function showLoading(show) {
  if (show) {
    $('#loadingIndicator').show();
  } else {
    $('#loadingIndicator').hide();
  }
}

function showError(message) {
  const $errorContainer = $('#errorContainer');
  $errorContainer.html(`
    <p class="font-bold">Error</p>
    <p>${message}</p>
  `);
  $errorContainer.removeClass('hidden');
}

// Refresh data every 5 minutes
setInterval(async () => {
  try {
    await loadData();
    await loadPerformanceMetrics();
    $('#lastUpdated').text(new Date().toLocaleString());
  } catch (error) {
    console.error('Error refreshing data:', error);
  }
}, 300000);
