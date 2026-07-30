// Datos de ejemplo para las métricas
const metricsData = [
  {
    title: 'Usuarios Activos',
    value: '12,458',
    change: '+12.5%',
    positive: true,
    icon: '👥',
    color: 'blue'
  },
  {
    title: 'Ingresos Mensuales',
    value: '$45,230',
    change: '+8.2%',
    positive: true,
    icon: '💰',
    color: 'green'
  },
  {
    title: 'Tasa de Conversión',
    value: '3.8%',
    change: '-2.1%',
    positive: false,
    icon: '📊',
    color: 'yellow'
  },
  {
    title: 'Tiempo Promedio',
    value: '4m 32s',
    change: '+5.4%',
    positive: false,
    icon: '⏱️',
    color: 'red'
  }
];

// Datos de ejemplo para los gráficos
const lineChartData = {
  labels: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul'],
  data: [1200, 1900, 3000, 5000, 4200, 6500, 7800]
};

const barChartData = {
  labels: ['Electrónica', 'Ropa', 'Hogar', 'Deportes', 'Otros'],
  data: [450, 320, 280, 190, 150]
};

// Renderizar tarjetas de métricas
function renderMetrics() {
  const grid = document.getElementById('metricsGrid');
  
  metricsData.forEach(metric => {
    const card = document.createElement('div');
    card.className = 'metric-card';
    
    card.innerHTML = `
      <div class="metric-header">
        <div class="metric-icon ${metric.color}">${metric.icon}</div>
        <span class="metric-title">${metric.title}</span>
      </div>
      <div class="metric-value">${metric.value}</div>
      <div class="metric-change ${metric.positive ? 'positive' : 'negative'}">
        ${metric.change} vs mes anterior
      </div>
    `;
    
    grid.appendChild(card);
  });
}

// Dibujar gráfico de líneas con canvas
function drawLineChart(canvas, data) {
  const ctx = canvas.getContext('2d');
  const width = canvas.width = canvas.offsetWidth * 2;
  const height = canvas.height = canvas.offsetHeight * 2;
  ctx.scale(2, 2);
  
  const padding = 40;
  const chartWidth = width / 2 - padding * 2;
  const chartHeight = height / 2 - padding * 2;
  
  // Limpiar canvas
  ctx.clearRect(0, 0, width, height);
  
  // Dibujar grid
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 0.5;
  
  for (let i = 0; i <= 5; i++) {
    const y = padding + (chartHeight / 5) * i;
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(padding + chartWidth, y);
    ctx.stroke();
  }
  
  // Dibujar línea
  const maxValue = Math.max(...data.data);
  const stepX = chartWidth / (data.labels.length - 1);
  
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  
  ctx.beginPath();
  data.data.forEach((value, index) => {
    const x = padding + stepX * index;
    const y = padding + chartHeight - (value / maxValue) * chartHeight;
    
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.stroke();
  
  // Dibujar puntos
  ctx.fillStyle = '#3b82f6';
  data.data.forEach((value, index) => {
    const x = padding + stepX * index;
    const y = padding + chartHeight - (value / maxValue) * chartHeight;
    
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
  });
  
  // Dibujar etiquetas X
  ctx.fillStyle = '#94a3b8';
  ctx.font = '12px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  
  data.labels.forEach((label, index) => {
    const x = padding + stepX * index;
    ctx.fillText(label, x, padding + chartHeight + 20);
  });
}

// Dibujar gráfico de barras con canvas
function drawBarChart(canvas, data) {
  const ctx = canvas.getContext('2d');
  const width = canvas.width = canvas.offsetWidth * 2;
  const height = canvas.height = canvas.offsetHeight * 2;
  ctx.scale(2, 2);
  
  const padding = 40;
  const chartWidth = width / 2 - padding * 2;
  const chartHeight = height / 2 - padding * 2;
  
  // Limpiar canvas
  ctx.clearRect(0, 0, width, height);
  
  // Dibujar grid
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 0.5;
  
  for (let i = 0; i <= 5; i++) {
    const y = padding + (chartHeight / 5) * i;
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(padding + chartWidth, y);
    ctx.stroke();
  }
  
  // Dibujar barras
  const maxValue = Math.max(...data.data);
  const barWidth = (chartWidth / data.labels.length) * 0.6;
  const gap = (chartWidth / data.labels.length) * 0.4;
  
  const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];
  
  data.data.forEach((value, index) => {
    const x = padding + (chartWidth / data.labels.length) * index + gap / 2;
    const barHeight = (value / maxValue) * chartHeight;
    const y = padding + chartHeight - barHeight;
    
    // Gradiente
    const gradient = ctx.createLinearGradient(x, y, x, y + barHeight);
    gradient.addColorStop(0, colors[index % colors.length]);
    gradient.addColorStop(1, colors[index % colors.length] + '80');
    
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.roundRect(x, y, barWidth, barHeight, 4);
    ctx.fill();
    
    // Etiqueta X
    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(data.labels[index], x + barWidth / 2, padding + chartHeight + 20);
  });
}

// Inicializar
document.addEventListener('DOMContentLoaded', () => {
  renderMetrics();
  
  const lineCanvas = document.getElementById('lineChart');
  const barCanvas = document.getElementById('barChart');
  
  if (lineCanvas) {
    drawLineChart(lineCanvas, lineChartData);
  }
  
  if (barCanvas) {
    drawBarChart(barCanvas, barChartData);
  }
  
  // Redibujar al cambiar tamaño de ventana
  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      if (lineCanvas) drawLineChart(lineCanvas, lineChartData);
      if (barCanvas) drawBarChart(barCanvas, barChartData);
    }, 250);
  });
});
