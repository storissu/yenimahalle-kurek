import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchWeather, refreshWeather, weatherKeys } from './api';

export function useWeather(trainingId: string | undefined) {
  return useQuery({
    queryKey: weatherKeys.forTraining(trainingId ?? ''),
    queryFn: () => fetchWeather(trainingId as string),
    enabled: Boolean(trainingId),
    staleTime: 5 * 60_000,
  });
}

export function useRefreshWeather(trainingId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => refreshWeather(trainingId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: weatherKeys.all }),
  });
}
