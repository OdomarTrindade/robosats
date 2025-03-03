import React, { useEffect, useState, useContext } from 'react';
import {
  ResponsiveLine,
  type Serie,
  type Datum,
  type PointTooltipProps,
  type PointMouseHandler,
  type Point,
  type CustomLayer,
} from '@nivo/line';
import {
  Box,
  CircularProgress,
  Grid,
  IconButton,
  MenuItem,
  Paper,
  Select,
  useTheme,
} from '@mui/material';
import { AddCircleOutline, RemoveCircleOutline } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type PublicOrder from '../../../models';
import { matchMedian } from '../../../utils';
import currencyDict from '../../../../static/assets/currencies.json';
import getNivoScheme from '../NivoScheme';
import OrderTooltip from '../helpers/OrderTooltip';
import { type UseAppStoreType, AppContext } from '../../../contexts/AppContext';
import {
  FederationContext,
  type UseFederationStoreType,
} from '../../../contexts/FederationContext';

interface DepthChartProps {
  maxWidth: number;
  maxHeight: number;
  fillContainer?: boolean;
  elevation?: number;
  onOrderClicked?: (id: number, shortAlias: string) => void;
}

const DepthChart: React.FC<DepthChartProps> = ({
  maxWidth,
  maxHeight,
  fillContainer = false,
  elevation = 6,
  onOrderClicked = () => null,
}) => {
  const { fav } = useContext<UseAppStoreType>(AppContext);
  const { federation, federationUpdatedAt } = useContext<UseFederationStoreType>(FederationContext);
  const { t } = useTranslation();
  const theme = useTheme();
  const [enrichedOrders, setEnrichedOrders] = useState<PublicOrder[]>([]);
  const [series, setSeries] = useState<Serie[]>([]);
  const [rangeSteps, setRangeSteps] = useState<number>(8);
  const [xRange, setXRange] = useState<number>(8);
  const [xType, setXType] = useState<string>('premium');
  const [currencyCode, setCurrencyCode] = useState<number>(1);
  const [center, setCenter] = useState<number>();

  const height = maxHeight < 10 ? 10 : maxHeight;
  const width = maxWidth < 10 ? 10 : maxWidth > 72.8 ? 72.8 : maxWidth;

  useEffect(() => {
    setCurrencyCode(fav.currency === 0 ? 1 : fav.currency);
  }, [fav.currency]);

  useEffect(() => {
    if (federation.book.length > 0) {
      const enriched = federation.book.map((order) => {
        // We need to transform all currencies to the same base (ex. USD), we don't have the exchange rate
        // for EUR -> USD, but we know the rate of both to BTC, so we get advantage of it and apply a
        // simple rule of three
        if (order.coordinatorShortAlias != null) {
          const limits = federation.getCoordinator(order.coordinatorShortAlias).limits;
          const price = limits[currencyCode] ? limits[currencyCode].price : 0;
          order.base_amount = (order.price * price) / price;
        }
        return order;
      });
      setEnrichedOrders(enriched);
    }
  }, [federationUpdatedAt, currencyCode]);

  useEffect(() => {
    if (enrichedOrders.length > 0) {
      generateSeries();
    }
  }, [enrichedOrders, xRange]);

  useEffect(() => {
    if (xType === 'base_amount') {
      const prices: number[] = enrichedOrders.map((order) => order?.base_amount ?? 0);

      const medianValue = ~~matchMedian(prices);
      const maxValue = prices.sort((a, b) => b - a).slice(0, 1)[0] ?? 1500;
      const maxRange = maxValue - medianValue;
      const rangeSteps = maxRange / 10;

      setCenter(medianValue);
      setXRange(maxRange);
      setRangeSteps(rangeSteps);
    } else {
      if (federation.exchange.info?.last_day_nonkyc_btc_premium === undefined) {
        const premiums: number[] = enrichedOrders.map((order) => order?.premium ?? 0);
        setCenter(~~matchMedian(premiums));
      } else {
        setCenter(federation.exchange.info?.last_day_nonkyc_btc_premium);
      }
      setXRange(8);
      setRangeSteps(0.5);
    }
  }, [enrichedOrders, xType, federationUpdatedAt, currencyCode]);

  const generateSeries: () => void = () => {
    const sortedOrders: PublicOrder[] =
      xType === 'base_amount'
        ? enrichedOrders.sort(
            (order1, order2) => (order1?.base_amount ?? 0) - (order2?.base_amount ?? 0),
          )
        : enrichedOrders.sort((order1, order2) => order1.premium - order2.premium);

    const sortedBuyOrders: PublicOrder[] = sortedOrders
      .filter((order) => order.type === 0)
      .reverse();
    const sortedSellOrders: PublicOrder[] = sortedOrders.filter((order) => order.type === 1);

    const buySerie: Datum[] = generateSerie(sortedBuyOrders);
    const sellSerie: Datum[] = generateSerie(sortedSellOrders);

    const maxX: number = (center ?? 0) + xRange;
    const minX: number = (center ?? 0) - xRange;

    setSeries([
      {
        id: 'buy',
        data: closeSerie(buySerie, maxX, minX),
      },
      {
        id: 'sell',
        data: closeSerie(sellSerie, minX, maxX),
      },
    ]);
  };

  const generateSerie = (orders: PublicOrder[]): Datum[] => {
    if (center === undefined) {
      return [];
    }

    let sumOrders: number = 0;
    let serie: Datum[] = [];
    orders.forEach((order) => {
      const lastSumOrders = sumOrders;
      sumOrders += (order.satoshis_now ?? 0) / 100000000;
      const datum: Datum[] = [
        {
          // Vertical Line
          x: xType === 'base_amount' ? order.base_amount : order.premium,
          y: lastSumOrders,
        },
        {
          // PublicOrder Point
          x: xType === 'base_amount' ? order.base_amount : order.premium,
          y: sumOrders,
          order,
        },
      ];

      serie = [...serie, ...datum];
    });
    const inlineSerie = serie.filter((datum: Datum) => {
      return Number(datum.x) > center - xRange && Number(datum.x) < center + xRange;
    });

    return inlineSerie;
  };

  const closeSerie = (serie: Datum[], limitBottom: number, limitTop: number): Datum[] => {
    if (serie.length === 0) {
      return [];
    }

    // If the bottom is not 0, exdens the horizontal bottom line
    if (serie[0].y !== 0) {
      const startingPoint: Datum = {
        x: limitBottom,
        y: serie[0].y,
      };
      serie.unshift(startingPoint);
    }

    // exdens the horizontal top line
    const endingPoint: Datum = {
      x: limitTop,
      y: serie[serie.length - 1].y,
    };

    return [...serie, endingPoint];
  };

  const centerLine: CustomLayer = (props) => (
    <path
      key='center-line'
      d={props.lineGenerator([
        {
          y: 0,
          x: props.xScale(center ?? 0),
        },
        {
          y: props.innerHeight,
          x: props.xScale(center ?? 0),
        },
      ])}
      fill='none'
      stroke={getNivoScheme(theme).markers?.lineColor}
      strokeWidth={getNivoScheme(theme).markers?.lineStrokeWidth}
    />
  );

  const generateTooltip: React.FunctionComponent<PointTooltipProps> = (
    pointTooltip: PointTooltipProps,
  ) => {
    const order: PublicOrder = pointTooltip.point.data.order;
    return <OrderTooltip order={order} />;
  };

  const formatAxisX = (value: number): string => {
    if (xType === 'base_amount') {
      return value.toString();
    }
    return `${value}%`;
  };
  const formatAxisY = (value: number): string => `${value}BTC`;
  const handleOnClick: PointMouseHandler = (point: Point) => {
    onOrderClicked(point.data?.order?.id, point.data?.order?.coordinatorShortAlias);
  };

  const em = theme.typography.fontSize;
  return (
    <Paper
      elevation={elevation}
      style={
        fillContainer
          ? { width: '100%', maxHeight: '100%', height: '100%' }
          : { width: `${width}em`, maxHeight: `${height}em` }
      }
    >
      <Paper variant='outlined' style={{ width: '100%', height: '100%' }}>
        {center === undefined || enrichedOrders.length < 1 ? (
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              paddingTop: `${(height - 3) / 2 - 1}em`,
              height: `${height}em`,
            }}
          >
            <CircularProgress />
          </div>
        ) : (
          <Grid container style={{ paddingTop: '1em' }}>
            <Grid
              container
              direction='row'
              justifyContent='space-around'
              alignItems='flex-start'
              style={{ position: 'absolute' }}
            >
              <Grid
                container
                justifyContent='flex-start'
                alignItems='flex-start'
                style={{ paddingLeft: '1em' }}
              >
                <Select
                  variant='standard'
                  value={xType}
                  onChange={(e) => {
                    setXType(e.target.value);
                  }}
                >
                  <MenuItem value={'premium'}>
                    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
                      {t('Premium')}
                    </div>
                  </MenuItem>
                  <MenuItem value={'base_amount'}>
                    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
                      {t('Price')}
                    </div>
                  </MenuItem>
                </Select>
              </Grid>
            </Grid>
            <Grid container direction='row' justifyContent='center' alignItems='center'>
              <Grid container justifyContent='center' alignItems='center'>
                <Grid item>
                  <IconButton
                    onClick={() => {
                      setXRange(xRange + rangeSteps);
                    }}
                  >
                    <RemoveCircleOutline />
                  </IconButton>
                </Grid>
                <Grid item>
                  <Box justifyContent='center'>
                    {xType === 'base_amount'
                      ? `${center} ${String(currencyDict[currencyCode])}`
                      : `${String(center.toPrecision(3))}%`}
                  </Box>
                </Grid>
                <Grid item>
                  <IconButton
                    onClick={() => {
                      setXRange(xRange - rangeSteps);
                    }}
                    disabled={xRange <= 1}
                  >
                    <AddCircleOutline />
                  </IconButton>
                </Grid>
              </Grid>
            </Grid>
            <Grid container style={{ height: `${height * 0.8}em`, padding: '1em' }}>
              <ResponsiveLine
                data={series}
                enableArea={true}
                useMesh={true}
                animate={false}
                crosshairType='cross'
                tooltip={generateTooltip}
                onClick={handleOnClick}
                axisLeft={{
                  tickSize: 5,
                  format: formatAxisY,
                }}
                axisBottom={{
                  tickSize: 5,
                  tickRotation:
                    xType === 'base_amount' ? (width < 40 ? 45 : 0) : width < 25 ? 45 : 0,
                  format: formatAxisX,
                }}
                margin={{
                  left: 4.64 * em,
                  right: 0.714 * em,
                  bottom:
                    xType === 'base_amount'
                      ? width < 40
                        ? 2.7 * em
                        : 1.78 * em
                      : width < 25
                        ? 2.7 * em
                        : 1.78 * em,
                  top: 0.714 * em,
                }}
                xFormat={(value) => Number(value).toFixed(0)}
                lineWidth={3}
                theme={getNivoScheme(theme)}
                colors={[theme.palette.secondary.main, theme.palette.primary.main]}
                xScale={{
                  type: 'linear',
                  min: center - xRange,
                  max: center + xRange,
                }}
                layers={['axes', 'areas', 'crosshair', 'lines', centerLine, 'slices', 'mesh']}
              />
            </Grid>
          </Grid>
        )}
      </Paper>
    </Paper>
  );
};

export default DepthChart;
