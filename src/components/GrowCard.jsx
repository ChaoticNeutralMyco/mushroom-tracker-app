import React from "react";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const GrowCard = ({ grow, onEdit, onDelete }) => {
  return (
    <Card className="shadow-md hover:shadow-lg transition-shadow">
      <CardHeader className="flex flex-col items-start space-y-1">
        <CardTitle className="text-lg font-semibold">
          {grow.strain || "Unnamed Grow"}
        </CardTitle>
        <Badge variant="outline">{grow.stage}</Badge>
      </CardHeader>

      <CardContent className="space-y-2 text-sm text-muted-foreground">
        <p><span className="font-medium text-foreground">Start Date:</span> {grow.date}</p>
        <p><span className="font-medium text-foreground">Cost:</span> ${grow.cost || "0.00"}</p>
        <p><span className="font-medium text-foreground">Yield:</span> {grow.yield || "0"}g</p>
        {grow.notes && (
          <p><span className="font-medium text-foreground">Notes:</span> {grow.notes}</p>
        )}
      </CardContent>

      <CardFooter className="flex justify-between gap-2">
        <Button variant="outline" onClick={() => onEdit(grow)}>Edit</Button>
        <Button variant="destructive" onClick={() => onDelete(grow.id)}>Delete</Button>
      </CardFooter>
    </Card>
  );
};

export default GrowCard;
