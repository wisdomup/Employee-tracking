import React from 'react';
import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
);

interface LineTrendChartProps {
  labels: string[];
  values?: number[];
  datasets?: Array<{
    label: string;
    values: number[];
    borderColor?: string;
    backgroundColor?: string;
    fill?: boolean;
  }>;
  height?: number;
  compact?: boolean;
  emptyText?: string;
}

const LineTrendChart: React.FC<LineTrendChartProps> = ({
  labels,
  values = [],
  datasets,
  height = 96,
  compact = false,
  emptyText = 'No chart data in selected range',
}) => {
  const normalizedDatasets =
    datasets && datasets.length > 0
      ? datasets.map((series, idx) => ({
          label: series.label,
          data: series.values,
          borderColor:
            series.borderColor ??
            (idx % 4 === 0
              ? '#1d4ed8'
              : idx % 4 === 1
                ? '#16a34a'
                : idx % 4 === 2
                  ? '#dc2626'
                  : '#7c3aed'),
          backgroundColor:
            series.backgroundColor ??
            (idx % 4 === 0
              ? 'rgba(29, 78, 216, 0.12)'
              : idx % 4 === 1
                ? 'rgba(22, 163, 74, 0.12)'
                : idx % 4 === 2
                  ? 'rgba(220, 38, 38, 0.12)'
                  : 'rgba(124, 58, 237, 0.12)'),
          fill: series.fill ?? false,
          borderWidth: 2.2,
          tension: 0.35,
          pointRadius: compact ? 0 : 3,
          pointHoverRadius: compact ? 0 : 4,
        }))
      : [
          {
            label: 'Sales',
            data: values,
            borderColor: compact ? '#2563eb' : '#1d4ed8',
            backgroundColor: compact
              ? 'rgba(37, 99, 235, 0.14)'
              : 'rgba(29, 78, 216, 0.12)',
            fill: true,
            borderWidth: 2.2,
            tension: 0.35,
            pointRadius: compact ? 0 : 3,
            pointHoverRadius: compact ? 0 : 4,
          },
        ];

  const hasData = normalizedDatasets.some((d) => d.data.some((v) => Number(v) !== 0));

  if (!hasData) {
    return <div style={{ textAlign: 'center', color: '#6b7280', padding: '1rem' }}>{emptyText}</div>;
  }

  const data = {
    labels,
    datasets: normalizedDatasets,
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: !compact && normalizedDatasets.length > 1 },
      tooltip: {
        enabled: true,
        mode: 'index' as const,
        intersect: false,
      },
    },
    interaction: {
      mode: 'index' as const,
      intersect: false,
    },
    scales: compact
      ? {
          x: { display: false },
          y: { display: false },
        }
      : {
          x: {
            grid: { color: '#e5e7eb' },
            ticks: {
              color: '#4b5563',
              maxRotation: 0,
              autoSkip: true,
            },
          },
          y: {
            grid: { color: '#e5e7eb' },
            ticks: { color: '#4b5563' },
            beginAtZero: true,
          },
        },
  };

  return (
    <div style={{ width: '100%', height }}>
      <Line data={data} options={options} />
    </div>
  );
};

export default LineTrendChart;
