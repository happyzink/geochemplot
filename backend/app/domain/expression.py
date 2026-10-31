"""Expression AST - discriminated union for variable computation"""
from __future__ import annotations

from typing import Annotated, Literal, Optional, Union

from pydantic import BaseModel, Field


class MeasurementExpr(BaseModel):
    kind: Literal["measurement"] = "measurement"
    analyte: str = Field(..., min_length=1, description="Element or oxide symbol, e.g. La, SiO2")
    chemical_form: Literal["element", "oxide", "isotope_ratio", "index"]
    unit: str = Field(..., min_length=1, description="e.g. ppm, ppb, wt%")
    channel: Optional[str] = Field(None, description="Measurement channel, e.g. La139_ppm_mean")


class NormalizeExpr(BaseModel):
    kind: Literal["normalize"] = "normalize"
    value: "Expression"
    reference_id: str = Field(..., min_length=1)
    reference_version: str = Field(..., min_length=1)

    @property
    def analyte(self) -> Optional[str]:
        """Get analyte from child measurement expression."""
        if isinstance(self.value, MeasurementExpr):
            return self.value.analyte
        return None


class RatioExpr(BaseModel):
    kind: Literal["ratio"] = "ratio"
    numerator: "Expression"
    denominator: "Expression"


class AddExpr(BaseModel):
    kind: Literal["add"] = "add"
    operands: list["Expression"] = Field(..., min_length=2)


class ConstantExpr(BaseModel):
    kind: Literal["constant"] = "constant"
    value: float
    unit: str = Field(..., min_length=1)


Expression = Annotated[
    Union[MeasurementExpr, NormalizeExpr, RatioExpr, AddExpr, ConstantExpr],
    Field(discriminator="kind"),
]

MeasurementExpr.model_rebuild()
NormalizeExpr.model_rebuild()
RatioExpr.model_rebuild()
AddExpr.model_rebuild()

MAX_EXPRESSION_DEPTH = 8
MAX_EXPRESSION_NODES = 64


def validate_expression_tree(expr, depth: int = 0, nodes: list[int] | None = None) -> None:
    if nodes is None:
        nodes = [0]
    nodes[0] += 1
    if depth > MAX_EXPRESSION_DEPTH:
        raise ValueError(f"Expression tree depth {depth} exceeds maximum {MAX_EXPRESSION_DEPTH}")
    if nodes[0] > MAX_EXPRESSION_NODES:
        raise ValueError(f"Expression node count {nodes[0]} exceeds maximum {MAX_EXPRESSION_NODES}")

    if isinstance(expr, NormalizeExpr):
        validate_expression_tree(expr.value, depth + 1, nodes)
    elif isinstance(expr, RatioExpr):
        validate_expression_tree(expr.numerator, depth + 1, nodes)
        validate_expression_tree(expr.denominator, depth + 1, nodes)
    elif isinstance(expr, AddExpr):
        for op in expr.operands:
            validate_expression_tree(op, depth + 1, nodes)
